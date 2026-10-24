import { randomInt, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { signInWithUsername, type LoginDeps } from "@/modules/identity/login";
import { AppError } from "@/shared/errors/app-error";
import { TEST_EMAIL_DOMAIN, TestFixtures, createAdminClient } from "./helpers/auth";
import { attempt, createTestPool, withRollback } from "./helpers/db";

// 02-DOMINIO §1.4 (decisión del 2026-10-24): límite de intentos en la aplicación y eventos de seguridad.
// Auth se simula: el límite propio de Supabase local es por IP (la del runner) y estas pruebas lo agotarían.
// El perfil, el negocio y la auditoría sí son reales.

const pool = createTestPool();
const fixtures = new TestFixtures(pool, createAdminClient());

afterAll(async () => {
  await fixtures.purge();
  await pool.end();
});

const RESTRICT_VIOLATION = "23001";
const MINUTE = 60_000;

type AuthReply = { data: { user: { id: string } | null; session: null }; error: unknown };
const wrongPassword: AuthReply = {
  data: { user: null, session: null },
  error: { status: 400, message: "Invalid login credentials" },
};
const accepted = (userId: string): AuthReply => ({
  data: { user: { id: userId }, session: null },
  error: null,
});

/** Auth simulado: cada llamada devuelve lo que diga `reply`, tras `delayMs`. */
function fakeAuth(reply: () => AuthReply, delayMs = 0) {
  const signInWithPassword = vi.fn(async () => {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    return reply();
  });
  const supabase = {
    auth: { signInWithPassword, signOut: vi.fn(async () => ({ error: null })) },
  } as unknown as LoginDeps["supabase"];
  return { supabase, signInWithPassword };
}

/** Reloj manual: cada prueba parte de la hora real para no cruzarse con otras ejecuciones. */
function clock() {
  let current = Date.now();
  return {
    now: () => new Date(current),
    advance: (ms: number) => {
      current += ms;
    },
  };
}

const unique = () => `u.${randomUUID().slice(0, 8)}`;
const uniqueIp = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
const password = "Incorrecta123";

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error.code;
    throw error;
  }
  return undefined;
}

async function eventsOf(username: string) {
  const { rows } = await pool.query<{ result: string; ip: string | null }>(
    "select result, host(ip) as ip from public.login_security_events where username = $1 order by occurred_at, result",
    [username],
  );
  return rows;
}

describe("límite por usuario: 5 fallos seguidos en 15 minutos bloquean 15 minutos", () => {
  it("al 6.º intento responde TOO_MANY_ATTEMPTS sin consultar a Auth, aun con la contraseña correcta", async () => {
    const business = await fixtures.business();
    const account = await fixtures.account({ role: "COBRADOR", businessId: business });
    const time = clock();
    let reply = wrongPassword;
    const { supabase, signInWithPassword } = fakeAuth(() => reply);
    const deps: LoginDeps = {
      supabase,
      db: pool,
      syntheticEmailDomain: TEST_EMAIL_DOMAIN,
      ...time,
    };

    for (let i = 0; i < 5; i += 1) {
      expect(await codeOf(signInWithUsername(deps, { username: account.username, password }))).toBe(
        "INVALID_CREDENTIALS",
      );
      time.advance(MINUTE);
    }
    reply = accepted(account.userId);

    const blocked = signInWithUsername(deps, account);
    await expect(blocked).rejects.toMatchObject({
      code: "TOO_MANY_ATTEMPTS",
      status: 429,
      message: "Demasiados intentos fallidos. Espera 15 minutos e intenta de nuevo",
    });
    expect(signInWithPassword).toHaveBeenCalledTimes(5);
    expect((await eventsOf(account.username)).map((event) => event.result)).toEqual([
      ...Array(5).fill("CREDENCIALES_INVALIDAS"),
      "USUARIO_BLOQUEADO_TEMPORALMENTE",
    ]);
  });

  it("se desbloquea 15 minutos después del 5.º fallo (reloj inyectado), y los rechazos no alargan el bloqueo", async () => {
    const business = await fixtures.business();
    const account = await fixtures.account({ role: "COBRADOR", businessId: business });
    const time = clock();
    let reply = wrongPassword;
    const { supabase } = fakeAuth(() => reply);
    const deps: LoginDeps = {
      supabase,
      db: pool,
      syntheticEmailDomain: TEST_EMAIL_DOMAIN,
      ...time,
    };

    for (let i = 0; i < 5; i += 1) {
      await codeOf(signInWithUsername(deps, { username: account.username, password }));
      time.advance(1_000);
    }
    reply = accepted(account.userId);
    // Quinto fallo en t = 4 s: bloqueado hasta t = 15 min 4 s. Se insiste a mitad del bloqueo.
    time.advance(10 * MINUTE);
    expect(await codeOf(signInWithUsername(deps, account))).toBe("TOO_MANY_ATTEMPTS");
    time.advance(4 * MINUTE + 30_000);
    expect(await codeOf(signInWithUsername(deps, account))).toBe("TOO_MANY_ATTEMPTS");

    time.advance(MINUTE);
    expect((await signInWithUsername(deps, account)).userId).toBe(account.userId);
  });

  it("un usuario inexistente se bloquea igual: la respuesta no revela si existe", async () => {
    const time = clock();
    const { supabase } = fakeAuth(() => wrongPassword);
    const deps: LoginDeps = {
      supabase,
      db: pool,
      syntheticEmailDomain: TEST_EMAIL_DOMAIN,
      ...time,
    };
    const ghost = unique();

    for (let i = 0; i < 5; i += 1) {
      await codeOf(signInWithUsername(deps, { username: ghost, password }));
    }

    expect(await codeOf(signInWithUsername(deps, { username: ghost, password }))).toBe(
      "TOO_MANY_ATTEMPTS",
    );
  });

  it("un inicio de sesión exitoso reinicia el contador del usuario", async () => {
    const business = await fixtures.business();
    const account = await fixtures.account({ role: "COBRADOR", businessId: business });
    const time = clock();
    let reply = wrongPassword;
    const { supabase, signInWithPassword } = fakeAuth(() => reply);
    const deps: LoginDeps = {
      supabase,
      db: pool,
      syntheticEmailDomain: TEST_EMAIL_DOMAIN,
      ...time,
    };
    const fail = () => codeOf(signInWithUsername(deps, { username: account.username, password }));

    for (let i = 0; i < 4; i += 1) await fail();
    reply = accepted(account.userId);
    time.advance(1_000);
    await signInWithUsername(deps, account);
    reply = wrongPassword;
    time.advance(1_000);
    for (let i = 0; i < 4; i += 1) expect(await fail()).toBe("INVALID_CREDENTIALS");

    expect(await fail()).toBe("INVALID_CREDENTIALS");
    expect(signInWithPassword).toHaveBeenCalledTimes(10);
    expect(await fail()).toBe("TOO_MANY_ATTEMPTS");
  });

  it("solo cuentan las contraseñas incorrectas: cuenta bloqueada o negocio suspendido no suman", async () => {
    const business = await fixtures.business();
    const account = await fixtures.account({ role: "ADMIN_NEGOCIO", businessId: business });
    await fixtures.setBusinessAccess(business, "SUSPENDIDO");
    const time = clock();
    // El hook de Auth rechaza con 403 después de validar la contraseña.
    const { supabase } = fakeAuth(() => ({
      data: { user: null, session: null },
      error: { status: 403, message: "hook" },
    }));
    const deps: LoginDeps = {
      supabase,
      db: pool,
      syntheticEmailDomain: TEST_EMAIL_DOMAIN,
      ...time,
    };

    for (let i = 0; i < 6; i += 1) {
      expect(await codeOf(signInWithUsername(deps, account))).toBe("BUSINESS_SUSPENDED");
    }
    expect(new Set((await eventsOf(account.username)).map((event) => event.result))).toEqual(
      new Set(["NEGOCIO_SUSPENDIDO"]),
    );
  });

  it("dos peticiones simultáneas no superan el límite", async () => {
    const time = clock();
    // Auth lento: todas las peticiones están en vuelo a la vez.
    const { supabase, signInWithPassword } = fakeAuth(() => wrongPassword, 200);
    const deps: LoginDeps = {
      supabase,
      db: pool,
      syntheticEmailDomain: TEST_EMAIL_DOMAIN,
      ...time,
    };
    const target = unique();

    const codes = await Promise.all(
      Array.from({ length: 12 }, () =>
        codeOf(signInWithUsername(deps, { username: target, password })),
      ),
    );

    expect(signInWithPassword).toHaveBeenCalledTimes(5);
    expect(codes.filter((code) => code === "INVALID_CREDENTIALS")).toHaveLength(5);
    expect(codes.filter((code) => code === "TOO_MANY_ATTEMPTS")).toHaveLength(7);
  });
});

describe("límite por IP: más de 30 fallos en 15 minutos la bloquean 15 minutos", () => {
  it("30 fallos no bloquean; el 31.º sí, para cualquier usuario desde esa IP", async () => {
    const time = clock();
    const { supabase, signInWithPassword } = fakeAuth(() => wrongPassword);
    const deps: LoginDeps = {
      supabase,
      db: pool,
      syntheticEmailDomain: TEST_EMAIL_DOMAIN,
      ...time,
    };
    const ip = uniqueIp();
    const fromIp = (username: string) =>
      codeOf(signInWithUsername(deps, { username, password, ip }));

    for (let i = 0; i < 30; i += 1) expect(await fromIp(unique())).toBe("INVALID_CREDENTIALS");
    expect(await fromIp(unique())).toBe("INVALID_CREDENTIALS");
    expect(signInWithPassword).toHaveBeenCalledTimes(31);

    const victim = unique();
    expect(await fromIp(victim)).toBe("TOO_MANY_ATTEMPTS");
    expect(await eventsOf(victim)).toEqual([{ result: "IP_BLOQUEADA_TEMPORALMENTE", ip }]);
    // Otra IP no se ve afectada.
    expect(
      await codeOf(signInWithUsername(deps, { username: victim, password, ip: uniqueIp() })),
    ).toBe("INVALID_CREDENTIALS");

    time.advance(15 * MINUTE + 1_000);
    expect(await fromIp(unique())).toBe("INVALID_CREDENTIALS");
  });

  it("sin IP fiable (fuera de Vercel) solo aplica el límite por usuario", async () => {
    const time = clock();
    const { supabase } = fakeAuth(() => wrongPassword);
    const deps: LoginDeps = {
      supabase,
      db: pool,
      syntheticEmailDomain: TEST_EMAIL_DOMAIN,
      ...time,
    };

    for (let i = 0; i < 32; i += 1) {
      expect(
        await codeOf(signInWithUsername(deps, { username: unique(), password, ip: null })),
      ).toBe("INVALID_CREDENTIALS");
    }
  });
});

describe("eventos de seguridad", () => {
  it("guardan usuario normalizado, IP, fecha y motivo; nunca la contraseña", async () => {
    const time = clock();
    const { supabase } = fakeAuth(() => wrongPassword);
    const deps: LoginDeps = {
      supabase,
      db: pool,
      syntheticEmailDomain: TEST_EMAIL_DOMAIN,
      ...time,
    };
    const target = unique();
    const secret = `Secreta${randomUUID()}9`;

    await codeOf(
      signInWithUsername(deps, {
        username: `  ${target.toUpperCase()} `,
        password: secret,
        ip: "203.0.113.9",
      }),
    );

    const { rows } = await pool.query<{
      username: string;
      ip: string;
      result: string;
      occurred_at: Date;
      event: unknown;
    }>(
      `select username, host(ip) as ip, result, occurred_at, to_jsonb(e) as event
         from public.login_security_events e where username = $1`,
      [target],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      username: target,
      ip: "203.0.113.9",
      result: "CREDENCIALES_INVALIDAS",
      occurred_at: time.now(),
    });
    expect(JSON.stringify(rows)).not.toContain(secret);
  });

  it("son de solo agregado: no se reabren, ni se editan, ni se borran los recientes", async () => {
    await withRollback(pool, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into public.login_security_events (username, ip, result, occurred_at)
         values ('it.guard', null, 'CREDENCIALES_INVALIDAS', now()) returning id`,
      );
      const id = rows[0]!.id;

      for (const statement of [
        `update public.login_security_events set result = 'EXITOSO' where id = '${id}'`,
        `update public.login_security_events set username = 'otro' where id = '${id}'`,
        `delete from public.login_security_events where id = '${id}'`,
        "truncate public.login_security_events",
      ]) {
        expect((await attempt(client, statement))?.code, statement).toBe(RESTRICT_VIOLATION);
      }
    });
  });

  it("un intento EN_CURSO solo se cierra una vez, y solo cambia su resultado", async () => {
    await withRollback(pool, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into public.login_security_events (username, ip, result, occurred_at)
         values ('it.guard', null, 'EN_CURSO', now()) returning id`,
      );
      const id = rows[0]!.id;

      expect(
        await attempt(
          client,
          `update public.login_security_events set result = 'EXITOSO', username = 'x' where id = '${id}'`,
        ),
      ).toMatchObject({ code: RESTRICT_VIOLATION });
      expect(
        await attempt(
          client,
          `update public.login_security_events set result = 'EXITOSO' where id = '${id}'`,
        ),
      ).toBeNull();
    });
  });

  it("retención: un login exitoso purga los eventos de más de 90 días", async () => {
    const business = await fixtures.business();
    const account = await fixtures.account({ role: "COBRADOR", businessId: business });
    const old = unique();
    await pool.query(
      `insert into public.login_security_events (username, ip, result, occurred_at)
       values ($1, null, 'CREDENCIALES_INVALIDAS', now() - interval '91 days'),
              ($1, null, 'CREDENCIALES_INVALIDAS', now() - interval '89 days')`,
      [old],
    );
    const { supabase } = fakeAuth(() => accepted(account.userId));

    await signInWithUsername(
      { supabase, db: pool, syntheticEmailDomain: TEST_EMAIL_DOMAIN },
      account,
    );

    const { rows } = await pool.query<{ age: number }>(
      "select extract(day from now() - occurred_at)::int as age from public.login_security_events where username = $1",
      [old],
    );
    expect(rows.map((row) => row.age)).toEqual([89]);
  });
});
