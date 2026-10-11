import { afterAll, describe, expect, it, vi } from "vitest";
import { signInWithUsername } from "@/modules/identity/login";
import { completeFirstPasswordChange } from "@/modules/identity/password";
import { passwordIssues } from "@/modules/identity/password-policy";
import {
  resetAdminPassword,
  type ResetAdminPasswordDeps,
} from "@/modules/identity/reset-admin-password";
import { loadSessionContext, type SessionContext } from "@/modules/identity/session";
import { archiveBusiness, suspendBusiness } from "@/modules/subscriptions/lifecycle";
import { AppError } from "@/shared/errors/app-error";
import {
  TEST_EMAIL_DOMAIN,
  TestFixtures,
  createAdminClient,
  createAnonClient,
} from "./helpers/auth";
import { createTestPool } from "./helpers/db";

// ADR 0005 y 02-DOMINIO §1.4: el Super Admin restablece la contraseña del admin de un negocio.
// Deja al admin en PENDIENTE_CAMBIO_CONTRASENA, le revoca las sesiones y se audita (sin la contraseña).

const pool = createTestPool();
const admin = createAdminClient();
const fixtures = new TestFixtures(pool, admin);

afterAll(async () => {
  await fixtures.purge();
  await pool.end();
});

const deps = (overrides: Partial<ResetAdminPasswordDeps> = {}): ResetAdminPasswordDeps => ({
  db: pool,
  admin,
  ...overrides,
});

async function superAdmin(): Promise<SessionContext> {
  const account = await fixtures.account({ role: "SUPER_ADMIN", businessId: null });
  return loadSessionContext(account.userId, pool);
}

async function failureOf(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("se esperaba un AppError");
}

async function setup() {
  const businessId = await fixtures.business();
  const account = await fixtures.account({ role: "ADMIN_NEGOCIO", businessId });
  const actor = await superAdmin();
  return { businessId, account, actor };
}

const login = (
  client: ReturnType<typeof createAnonClient>,
  credentials: { username: string; password: string },
) =>
  signInWithUsername(
    { supabase: client, db: pool, syntheticEmailDomain: TEST_EMAIL_DOMAIN },
    credentials,
  );

const statusOf = async (userId: string) =>
  (
    await pool.query<{ status: string }>("select status from public.profiles where id = $1", [
      userId,
    ])
  ).rows[0]?.status;

const sessionCount = async (userId: string) =>
  (
    await pool.query<{ n: number }>(
      "select count(*)::int n from auth.sessions where user_id = $1",
      [userId],
    )
  ).rows[0]!.n;

async function auditOf(businessId: string, action = "ContrasenaRestablecida") {
  const { rows } = await pool.query<{
    actor_id: string | null;
    entity_type: string;
    entity_id: string;
    result: string;
    summary: Record<string, unknown>;
  }>(
    `select actor_id, entity_type, entity_id, result, summary from public.audit_events
      where business_id = $1 and action = $2 order by occurred_at`,
    [businessId, action],
  );
  return rows;
}

describe("resetAdminPassword", () => {
  it("devuelve una contraseña temporal válida: la anterior deja de servir y el admin debe cambiarla", async () => {
    const { businessId, account, actor } = await setup();

    const result = await resetAdminPassword(deps(), actor, { businessId });

    expect(result.admin).toEqual({ userId: account.userId, username: account.username });
    expect(passwordIssues(result.temporaryPassword)).toEqual([]);
    expect(result.temporaryPassword).not.toBe(account.password);
    expect(await statusOf(account.userId)).toBe("PENDIENTE_CAMBIO_CONTRASENA");

    expect(await failureOf(login(createAnonClient(), account))).toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
    expect(
      await login(createAnonClient(), {
        username: account.username,
        password: result.temporaryPassword,
      }),
    ).toEqual({ userId: account.userId, role: "ADMIN_NEGOCIO", mustChangePassword: true });
  });

  it("revoca las sesiones abiertas del admin: ni siquiera renuevan el token", async () => {
    const { businessId, account, actor } = await setup();
    const device = createAnonClient();
    await login(device, account);
    expect((await device.auth.getUser()).error).toBeNull();
    expect(await sessionCount(account.userId)).toBeGreaterThan(0);

    const result = await resetAdminPassword(deps(), actor, { businessId });

    expect(await sessionCount(account.userId)).toBe(0);
    expect((await device.auth.refreshSession()).error).not.toBeNull();
    expect((await device.auth.getUser()).error).not.toBeNull();
    const [event] = await auditOf(businessId);
    expect(event?.summary).toMatchObject({ sessionsRevoked: expect.any(Number) });
    expect(result.temporaryPassword).toBeTruthy();
  });

  it("revoca las sesiones por sí mismo aunque Auth no lo haga (segunda barrera)", async () => {
    const { businessId, account, actor } = await setup();
    const device = createAnonClient();
    await login(device, account);
    expect(await sessionCount(account.userId)).toBeGreaterThan(0);
    // Auth simulado: dice que cambió la contraseña pero no toca las sesiones.
    const lenientAuth = {
      auth: { admin: { updateUserById: async () => ({ data: {}, error: null }) } },
    } as unknown as ResetAdminPasswordDeps["admin"];

    await resetAdminPassword(deps({ admin: lenientAuth }), actor, { businessId });

    expect(await sessionCount(account.userId)).toBe(0);
    expect((await device.auth.refreshSession()).error).not.toBeNull();
    const [event] = await auditOf(businessId);
    expect(event?.summary).toMatchObject({ sessionsRevoked: 1 });
  });

  it("no toca las sesiones de otros usuarios", async () => {
    const { businessId, actor } = await setup();
    const otherBusiness = await fixtures.business();
    const bystander = await fixtures.account({ role: "ADMIN_NEGOCIO", businessId: otherBusiness });
    const device = createAnonClient();
    await login(device, bystander);

    await resetAdminPassword(deps(), actor, { businessId });

    expect(await sessionCount(bystander.userId)).toBeGreaterThan(0);
    expect((await device.auth.getUser()).error).toBeNull();
  });

  it("audita ContrasenaRestablecida sobre el perfil del admin, sin la contraseña", async () => {
    const { businessId, account, actor } = await setup();

    const result = await resetAdminPassword(deps(), actor, { businessId });

    const events = await auditOf(businessId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actor_id: actor.userId,
      entity_type: "profile",
      entity_id: account.userId,
      result: "OK",
    });
    expect(events[0]?.summary).toMatchObject({ username: account.username, role: "ADMIN_NEGOCIO" });
    expect(JSON.stringify(events)).not.toContain(result.temporaryPassword);
  });

  it("funciona aunque el negocio esté suspendido o archivado (cambio de titular, ADR 0005)", async () => {
    const { businessId, account, actor } = await setup();
    await suspendBusiness({ db: pool }, actor, { businessId });
    await archiveBusiness({ db: pool }, actor, { businessId, reason: "Baja" });

    const result = await resetAdminPassword(deps(), actor, { businessId });

    expect(await statusOf(account.userId)).toBe("PENDIENTE_CAMBIO_CONTRASENA");
    // El negocio sigue bloqueado: la contraseña nueva no abre un acceso que está suspendido.
    expect(
      await failureOf(
        login(createAnonClient(), {
          username: account.username,
          password: result.temporaryPassword,
        }),
      ),
    ).toMatchObject({ code: "BUSINESS_SUSPENDED" });
  });

  it("repetirlo sobre un admin ya pendiente entrega una contraseña nueva y anula la anterior", async () => {
    const { businessId, account, actor } = await setup();

    const first = await resetAdminPassword(deps(), actor, { businessId });
    const second = await resetAdminPassword(deps(), actor, { businessId });

    expect(second.temporaryPassword).not.toBe(first.temporaryPassword);
    expect(
      await failureOf(
        login(createAnonClient(), {
          username: account.username,
          password: first.temporaryPassword,
        }),
      ),
    ).toMatchObject({ code: "INVALID_CREDENTIALS" });
    expect(
      await login(createAnonClient(), {
        username: account.username,
        password: second.temporaryPassword,
      }),
    ).toMatchObject({ mustChangePassword: true });
    expect(await auditOf(businessId)).toHaveLength(2);
  });

  it("un admin BLOQUEADO no se desbloquea restableciendo: 409 y no cambia nada", async () => {
    const { businessId, account, actor } = await setup();
    await fixtures.setProfileStatus(account.userId, "BLOQUEADO");

    expect(await failureOf(resetAdminPassword(deps(), actor, { businessId }))).toMatchObject({
      code: "USER_BLOCKED",
      status: 409,
    });
    expect(await statusOf(account.userId)).toBe("BLOQUEADO");
    expect(await auditOf(businessId)).toHaveLength(0);
  });

  it("dos restablecimientos simultáneos: la contraseña devuelta por el último en confirmar es la vigente", async () => {
    const { businessId, account, actor } = await setup();

    const results = await Promise.all([
      resetAdminPassword(deps(), actor, { businessId }),
      resetAdminPassword(deps(), actor, { businessId }),
    ]);

    const valid = [];
    for (const result of results) {
      try {
        await login(createAnonClient(), {
          username: account.username,
          password: result.temporaryPassword,
        });
        valid.push(result);
      } catch {
        // contraseña ya reemplazada por el otro restablecimiento
      }
    }
    expect(valid).toHaveLength(1);
    expect(await auditOf(businessId)).toHaveLength(2);
  });
});

describe("autorización y datos", () => {
  it("un negocio inexistente es 404 y uno sin cuenta admin también", async () => {
    const actor = await superAdmin();
    const withoutAdmin = await fixtures.business();

    expect(
      await failureOf(resetAdminPassword(deps(), actor, { businessId: crypto.randomUUID() })),
    ).toMatchObject({ code: "BUSINESS_NOT_FOUND", status: 404 });
    expect(
      await failureOf(resetAdminPassword(deps(), actor, { businessId: withoutAdmin })),
    ).toMatchObject({
      code: "ADMIN_NOT_FOUND",
      status: 404,
    });
  });

  it("un admin, un cobrador o un Super Admin con contraseña pendiente no pueden", async () => {
    const { businessId, account } = await setup();
    const cobrador = await fixtures.account({ role: "COBRADOR", businessId });
    const pendingSuper = await fixtures.account({
      role: "SUPER_ADMIN",
      businessId: null,
      status: "PENDIENTE_CAMBIO_CONTRASENA",
    });

    for (const [who, code] of [
      [account, "FORBIDDEN"], // el propio admin no se restablece por esta vía
      [cobrador, "FORBIDDEN"],
      [pendingSuper, "PASSWORD_CHANGE_REQUIRED"],
    ] as const) {
      const actor = await loadSessionContext(who.userId, pool);
      expect(
        await failureOf(resetAdminPassword(deps(), actor, { businessId })),
        code,
      ).toMatchObject({ code });
    }

    // Nadie cambió la contraseña del admin: la original sigue sirviendo.
    expect(await login(createAnonClient(), account)).toMatchObject({ role: "ADMIN_NEGOCIO" });
    const rejected = (await auditOf(businessId)).filter((event) => event.result === "RECHAZADO");
    expect(rejected).toHaveLength(2);
  });
});

describe("fallos entre Auth y la base de datos", () => {
  it("si Auth falla no cambia nada en la BD: ni estado, ni sesiones, ni auditoría", async () => {
    const { businessId, account, actor } = await setup();
    await login(createAnonClient(), account);
    const sessionsBefore = await sessionCount(account.userId);
    const brokenAuth = {
      auth: {
        admin: { updateUserById: async () => ({ data: null, error: { message: "Auth caído" } }) },
      },
    } as unknown as ResetAdminPasswordDeps["admin"];

    expect(
      await failureOf(resetAdminPassword(deps({ admin: brokenAuth }), actor, { businessId })),
    ).toMatchObject({
      code: "AUTH_UNAVAILABLE",
      status: 503,
    });

    expect(await statusOf(account.userId)).toBe("ACTIVO");
    expect(await sessionCount(account.userId)).toBe(sessionsBefore);
    expect(await auditOf(businessId)).toHaveLength(0);
    expect(await login(createAnonClient(), account)).toMatchObject({ role: "ADMIN_NEGOCIO" });
  });

  it("si falla la auditoría la BD se revierte; Auth ya había cambiado la contraseña (fallo seguro) y reintentar lo completa", async () => {
    const { businessId, account, actor } = await setup();
    await login(createAnonClient(), account);
    const failingAuditDb = {
      query: pool.query.bind(pool),
      connect: async () => {
        const client = await pool.connect();
        const original = client.query.bind(client) as (...args: unknown[]) => Promise<unknown>;
        client.query = ((text: unknown, ...rest: unknown[]) =>
          typeof text === "string" && text.includes("insert into public.audit_events")
            ? Promise.reject(new Error("fallo forzado de auditoría"))
            : original(text, ...rest)) as typeof client.query;
        const release = client.release.bind(client);
        client.release = (() => release(true)) as typeof client.release;
        return client;
      },
    } as unknown as ResetAdminPasswordDeps["db"];

    await expect(
      resetAdminPassword(deps({ db: failingAuditDb }), actor, { businessId }),
    ).rejects.toThrow("fallo forzado");

    expect(await statusOf(account.userId)).toBe("ACTIVO");
    expect(await auditOf(businessId)).toHaveLength(0);
    // Auth ya cambió la contraseña (y revocó las sesiones por su cuenta): la anterior no sirve y nadie
    // conoce la nueva, que es el lado seguro. El Super Admin repite el comando.
    expect(await failureOf(login(createAnonClient(), account))).toMatchObject({
      code: "INVALID_CREDENTIALS",
    });

    const retry = await resetAdminPassword(deps(), actor, { businessId });
    expect(
      await login(createAnonClient(), {
        username: account.username,
        password: retry.temporaryPassword,
      }),
    ).toMatchObject({ mustChangePassword: true });
  });
});

describe("endurecimiento tras la revisión", () => {
  it("si no se pueden borrar las sesiones por SQL, el restablecimiento sigue (Auth ya las revocó) y queda constancia", async () => {
    const { businessId, account, actor } = await setup();
    const device = createAnonClient();
    await login(device, account);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const noSessionDeleteDb = {
      query: pool.query.bind(pool),
      connect: async () => {
        const client = await pool.connect();
        const original = client.query.bind(client) as (...args: unknown[]) => Promise<unknown>;
        client.query = ((text: unknown, ...rest: unknown[]) =>
          typeof text === "string" && text.includes("delete from auth.sessions")
            ? Promise.reject(new Error("permission denied for table sessions"))
            : original(text, ...rest)) as typeof client.query;
        const release = client.release.bind(client);
        client.release = (() => release(true)) as typeof client.release;
        return client;
      },
    } as unknown as ResetAdminPasswordDeps["db"];

    try {
      const result = await resetAdminPassword(deps({ db: noSessionDeleteDb }), actor, {
        businessId,
      });

      expect(await statusOf(account.userId)).toBe("PENDIENTE_CAMBIO_CONTRASENA");
      expect((await device.auth.refreshSession()).error).not.toBeNull();
      const [event] = await auditOf(businessId);
      expect(event?.summary).toMatchObject({ sessionsRevoked: null });
      expect(
        await login(createAnonClient(), {
          username: account.username,
          password: result.temporaryPassword,
        }),
      ).toMatchObject({ mustChangePassword: true });
      expect(JSON.stringify(log.mock.calls)).not.toContain(result.temporaryPassword);
    } finally {
      log.mockRestore();
    }
  });

  it("carrera con el cambio obligatorio: la cuenta nunca queda ACTIVA con la contraseña temporal del Super Admin", async () => {
    const actor = await superAdmin();
    const pending = await fixtures.account({
      role: "ADMIN_NEGOCIO",
      businessId: await fixtures.business(),
      status: "PENDIENTE_CAMBIO_CONTRASENA",
    });
    const pendingBusiness = (
      await pool.query<{ business_id: string }>(
        "select business_id from public.profiles where id = $1",
        [pending.userId],
      )
    ).rows[0]!.business_id;
    const client = createAnonClient();
    await login(client, pending);
    const context = await loadSessionContext(pending.userId, pool);

    const [change, reset] = await Promise.allSettled([
      completeFirstPasswordChange({ supabase: client, db: pool }, context, "ElegidaPorElAdmin26"),
      resetAdminPassword(deps(), actor, { businessId: pendingBusiness }),
    ]);

    expect(reset.status).toBe("fulfilled");
    // Sea cual sea el orden, el estado final es el del restablecimiento: PENDIENTE, y su contraseña sirve.
    expect(await statusOf(pending.userId)).toBe("PENDIENTE_CAMBIO_CONTRASENA");
    const temporary = (reset as PromiseFulfilledResult<{ temporaryPassword: string }>).value
      .temporaryPassword;
    expect(
      await login(createAnonClient(), { username: pending.username, password: temporary }),
    ).toMatchObject({ mustChangePassword: true });
    // Si el cambio llegó a ganar, no puede haber dejado la contraseña elegida vigente.
    expect(
      await failureOf(
        login(createAnonClient(), { username: pending.username, password: "ElegidaPorElAdmin26" }),
      ),
    ).toMatchObject({ code: "INVALID_CREDENTIALS" });
    expect(["fulfilled", "rejected"]).toContain(change.status);
  });

  it("si otra transacción retiene el perfil, el restablecimiento se corta a los segundos (409) y no agota el pool", async () => {
    const { businessId, account, actor } = await setup();
    const holder = await pool.connect();
    try {
      await holder.query("begin");
      await holder.query("select 1 from public.profiles where id = $1 for update", [
        account.userId,
      ]);

      const started = Date.now();
      const error = await failureOf(resetAdminPassword(deps(), actor, { businessId }));

      expect(error).toMatchObject({ code: "OPERATION_IN_PROGRESS", status: 409 });
      expect(Date.now() - started).toBeLessThan(10_000);
    } finally {
      await holder.query("rollback");
      holder.release();
    }
    // Una vez libre, el comando funciona y no dejó nada a medias.
    expect(await auditOf(businessId)).toHaveLength(0);
    await resetAdminPassword(deps(), actor, { businessId });
    expect(await auditOf(businessId)).toHaveLength(1);
  });
});
