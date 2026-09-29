import { afterAll, describe, expect, it, vi } from "vitest";
import { signInWithUsername } from "@/modules/identity/login";
import { passwordIssues } from "@/modules/identity/password-policy";
import { loadSessionContext, type SessionContext } from "@/modules/identity/session";
import {
  createBusiness,
  type CreateBusinessDeps,
  type CreateBusinessInput,
} from "@/modules/subscriptions/create-business";
import { localDateIn } from "@/shared/dates/dates";
import { AppError } from "@/shared/errors/app-error";
import {
  TEST_EMAIL_DOMAIN,
  TestFixtures,
  createAdminClient,
  createAnonClient,
  decodeJwtClaims,
} from "./helpers/auth";
import { createTestPool } from "./helpers/db";

// 04-PLAN F1 (crear negocio + cuenta admin inicial) y 03-ARQUITECTURA §3 (Auth y BD no son atómicos:
// crear en Auth → transacción → compensar borrando el usuario de Auth si la BD falla).

const pool = createTestPool();
const admin = createAdminClient();
const fixtures = new TestFixtures(pool, admin);

afterAll(async () => {
  await fixtures.purge();
  await pool.end();
});

const deps = (overrides: Partial<CreateBusinessDeps> = {}): CreateBusinessDeps => ({
  db: pool,
  admin,
  syntheticEmailDomain: TEST_EMAIL_DOMAIN,
  ...overrides,
});

const unique = () => crypto.randomUUID().slice(0, 8);

function input(overrides: Partial<CreateBusinessInput> = {}): CreateBusinessInput {
  return {
    name: `Prestamos ${unique()}`,
    ownerName: "Ana Responsable",
    ownerIdentification: "1020304050",
    phone: "3001234567",
    planCode: "MENSUAL",
    adminUsername: `admin.${unique()}`,
    ...overrides,
  };
}

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

const authUserExists = async (username: string) =>
  (
    await pool.query("select 1 from auth.users where email = $1", [
      `${username}@${TEST_EMAIL_DOMAIN}`,
    ])
  ).rowCount === 1;

const businessCount = async (name: string) =>
  (await pool.query("select 1 from public.businesses where name = $1", [name])).rowCount ?? 0;

describe("createBusiness", () => {
  it("crea negocio, suscripción vigente, cuenta admin y auditoría en una operación", async () => {
    const actor = await superAdmin();
    const data = input({ planCode: "SEMANAL", timeZone: "America/Bogota" });
    // Fecha fija: sin depender de que la prueba corra justo antes de un cambio de día.
    const now = () => new Date("2026-09-28T15:00:00Z");

    const result = await createBusiness(deps({ now }), actor, data);
    fixtures.track({ businessId: result.businessId, userId: result.admin.userId });

    const business = await pool.query(
      "select name, owner_name, time_zone, access_status from public.businesses where id = $1",
      [result.businessId],
    );
    expect(business.rows[0]).toEqual({
      name: data.name,
      owner_name: "Ana Responsable",
      time_zone: "America/Bogota",
      access_status: "ACTIVO",
    });

    const today = localDateIn(now(), "America/Bogota");
    const subscription = await pool.query<{
      plan_code: string;
      status: string;
      starts_on: Date;
      expires_on: Date;
      changed_by: string;
    }>(
      "select plan_code, status, starts_on::text, expires_on::text, changed_by from public.subscriptions where business_id = $1",
      [result.businessId],
    );
    expect(subscription.rows[0]).toMatchObject({
      plan_code: "SEMANAL",
      status: "ACTIVA",
      starts_on: today,
      changed_by: actor.userId,
    });
    const days =
      (Date.parse(String(subscription.rows[0]!.expires_on)) -
        Date.parse(String(subscription.rows[0]!.starts_on))) /
      86_400_000;
    expect(days).toBe(7);

    const profile = await pool.query(
      "select business_id, role, username, status from public.profiles where id = $1",
      [result.admin.userId],
    );
    expect(profile.rows[0]).toEqual({
      business_id: result.businessId,
      role: "ADMIN_NEGOCIO",
      username: data.adminUsername,
      status: "PENDIENTE_CAMBIO_CONTRASENA",
    });

    const audit = await pool.query<{
      action: string;
      actor_id: string;
      business_id: string | null;
    }>(
      "select action, actor_id, business_id from public.audit_events where business_id = $1 order by action",
      [result.businessId],
    );
    expect(audit.rows.map((row) => row.action)).toEqual([
      "NegocioCreado",
      "SuscripcionCreada",
      "UsuarioCreado",
    ]);
    expect(audit.rows.every((row) => row.actor_id === actor.userId)).toBe(true);
  });

  it("starts_on sigue la zona del negocio, no UTC (Auckland ya es el día siguiente)", async () => {
    const actor = await superAdmin();
    // 23:00 UTC del 27 ya son las 11:00 del 28 en Auckland (UTC+12/+13): días distintos.
    const now = () => new Date("2026-09-27T23:00:00Z");
    const data = input({ timeZone: "Pacific/Auckland" });

    const result = await createBusiness(deps({ now }), actor, data);
    fixtures.track({ businessId: result.businessId, userId: result.admin.userId });

    const utcToday = localDateIn(now(), "UTC");
    const aucklandToday = localDateIn(now(), "Pacific/Auckland");
    expect(aucklandToday).not.toBe(utcToday);

    const { rows } = await pool.query<{ starts_on: string }>(
      "select starts_on::text from public.subscriptions where business_id = $1",
      [result.businessId],
    );
    expect(rows[0]?.starts_on).toBe(aucklandToday);
  });

  it("devuelve una contraseña temporal válida con la que el admin entra y debe cambiarla", async () => {
    const actor = await superAdmin();

    const result = await createBusiness(deps(), actor, input());
    fixtures.track({ businessId: result.businessId, userId: result.admin.userId });

    expect(passwordIssues(result.temporaryPassword)).toEqual([]);
    const client = createAnonClient();
    const login = await signInWithUsername(
      { supabase: client, db: pool, syntheticEmailDomain: TEST_EMAIL_DOMAIN },
      { username: result.admin.username, password: result.temporaryPassword },
    );
    expect(login).toEqual({
      userId: result.admin.userId,
      role: "ADMIN_NEGOCIO",
      mustChangePassword: true,
    });
    const { data } = await client.auth.getSession();
    expect(decodeJwtClaims(data.session!.access_token)).toMatchObject({
      app_role: "ADMIN_NEGOCIO",
      business_id: result.businessId,
    });
  });

  it("la contraseña temporal y el documento del responsable no quedan en la auditoría", async () => {
    const actor = await superAdmin();
    const data = input();

    const result = await createBusiness(deps(), actor, data);
    fixtures.track({ businessId: result.businessId, userId: result.admin.userId });

    const { rows } = await pool.query<{ summary: unknown }>(
      "select summary from public.audit_events where business_id = $1",
      [result.businessId],
    );
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain(result.temporaryPassword);
    expect(dump).not.toContain(data.ownerIdentification);
    expect(dump).toContain(data.adminUsername);
  });

  it("solo el Super Admin crea negocios; a un admin o cobrador lo rechaza sin crear nada", async () => {
    const business = await fixtures.business();
    for (const role of ["ADMIN_NEGOCIO", "COBRADOR"] as const) {
      const account = await fixtures.account({ role, businessId: business });
      const actor = await loadSessionContext(account.userId, pool);
      const data = input();

      expect(await failureOf(createBusiness(deps(), actor, data))).toMatchObject({
        code: "FORBIDDEN",
        status: 403,
      });
      expect(await businessCount(data.name)).toBe(0);
      expect(await authUserExists(data.adminUsername)).toBe(false);
    }
  });

  it("un Super Admin con contraseña temporal pendiente tampoco puede", async () => {
    const account = await fixtures.account({
      role: "SUPER_ADMIN",
      businessId: null,
      status: "PENDIENTE_CAMBIO_CONTRASENA",
    });
    const actor = await loadSessionContext(account.userId, pool);

    expect(await failureOf(createBusiness(deps(), actor, input()))).toMatchObject({
      code: "PASSWORD_CHANGE_REQUIRED",
    });
  });

  it("rechaza un usuario ya usado por otro negocio: 409 y sin residuos", async () => {
    const actor = await superAdmin();
    const first = await createBusiness(deps(), actor, input());
    fixtures.track({ businessId: first.businessId, userId: first.admin.userId });
    const second = input({ adminUsername: first.admin.username });

    expect(await failureOf(createBusiness(deps(), actor, second))).toMatchObject({
      code: "USERNAME_TAKEN",
      status: 409,
    });
    expect(await businessCount(second.name)).toBe(0);
  });

  it("rechaza un usuario que existe en Auth sin perfil (residuo) y no lo toca", async () => {
    const actor = await superAdmin();
    const data = input();
    const orphan = await admin.auth.admin.createUser({
      email: `${data.adminUsername}@${TEST_EMAIL_DOMAIN}`,
      password: "ClaveTemporal1",
      email_confirm: true,
    });
    fixtures.track({ userId: orphan.data.user!.id });

    expect(await failureOf(createBusiness(deps(), actor, data))).toMatchObject({
      code: "USERNAME_TAKEN",
    });
    expect(await authUserExists(data.adminUsername)).toBe(true);
    expect(await businessCount(data.name)).toBe(0);
  });

  it("valida antes de tocar Auth: usuario inválido, plan desconocido y zona horaria inválida", async () => {
    const actor = await superAdmin();
    const invalid: [Partial<CreateBusinessInput>, string][] = [
      [{ adminUsername: "No Válido" }, "INVALID_USERNAME"],
      [{ planCode: "TRIMESTRAL" as never }, "INVALID_PLAN"],
      [{ timeZone: "Marte/Olimpo" }, "INVALID_TIME_ZONE"],
    ];

    for (const [override, code] of invalid) {
      const data = input(override);
      expect(await failureOf(createBusiness(deps(), actor, data)), code).toMatchObject({ code });
      expect(await businessCount(data.name), code).toBe(0);
      expect(await authUserExists(data.adminUsername), code).toBe(false);
    }
  });

  it("si la BD falla tras crear el usuario en Auth, lo elimina (compensación) y no queda nada", async () => {
    const actor = await superAdmin();
    const data = input();
    const brokenDb = {
      connect: async () => {
        throw new Error("BD caída");
      },
      query: pool.query.bind(pool),
    } as unknown as CreateBusinessDeps["db"];

    await expect(createBusiness(deps({ db: brokenDb }), actor, data)).rejects.toThrow("BD caída");

    expect(await authUserExists(data.adminUsername)).toBe(false);
    expect(await businessCount(data.name)).toBe(0);
  });

  it("si una sentencia de la transacción falla, revierte todo y también compensa Auth", async () => {
    const actor = await superAdmin();
    const data = input();
    // Fuerza un error de BD dentro de la transacción tras haber creado el usuario en Auth.
    const failingSubscriptionDb = {
      query: pool.query.bind(pool),
      connect: async () => {
        const client = await pool.connect();
        const original = client.query.bind(client) as (...args: unknown[]) => Promise<unknown>;
        client.query = ((text: unknown, ...rest: unknown[]) =>
          typeof text === "string" && text.includes("insert into public.profiles")
            ? Promise.reject(new Error("fallo forzado al insertar el perfil"))
            : original(text, ...rest)) as typeof client.query;
        // El cliente parcheado no debe volver al pool: se destruye al liberarlo.
        const release = client.release.bind(client);
        client.release = (() => release(true)) as typeof client.release;
        return client;
      },
    } as unknown as CreateBusinessDeps["db"];

    await expect(createBusiness(deps({ db: failingSubscriptionDb }), actor, data)).rejects.toThrow(
      "fallo forzado",
    );

    expect(await authUserExists(data.adminUsername)).toBe(false);
    expect(await businessCount(data.name)).toBe(0);
    const audit = await pool.query(
      "select 1 from public.audit_events where summary ->> 'username' = $1",
      [data.adminUsername],
    );
    expect(audit.rowCount).toBe(0);
  });

  it("si la compensación también falla, informa el error original y registra el usuario huérfano", async () => {
    const actor = await superAdmin();
    const data = input();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const brokenDb = {
      connect: async () => {
        throw new Error("BD caída");
      },
      query: pool.query.bind(pool),
    } as unknown as CreateBusinessDeps["db"];
    const flakyAdmin = {
      auth: {
        admin: {
          createUser: admin.auth.admin.createUser.bind(admin.auth.admin),
          deleteUser: async () => ({ data: null, error: { message: "Auth caído" } }),
        },
      },
    } as unknown as CreateBusinessDeps["admin"];

    try {
      await expect(
        createBusiness(deps({ db: brokenDb, admin: flakyAdmin }), actor, data),
      ).rejects.toThrow("BD caída");

      const leftover = await pool.query<{ id: string }>(
        "select id from auth.users where email = $1",
        [`${data.adminUsername}@${TEST_EMAIL_DOMAIN}`],
      );
      fixtures.track({ userId: leftover.rows[0]?.id });

      const logged = JSON.stringify(log.mock.calls);
      expect(logged).toContain("huérfano");
      expect(logged).not.toContain("ClaveTemporal");
    } finally {
      log.mockRestore();
    }
  });

  it("dos envíos simultáneos con el mismo usuario crean un solo negocio", async () => {
    const actor = await superAdmin();
    const username = `admin.${unique()}`;
    const a = input({ adminUsername: username });
    const b = input({ adminUsername: username });

    const results = await Promise.allSettled([
      createBusiness(deps(), actor, a),
      createBusiness(deps(), actor, b),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);
    const created = (
      fulfilled[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof createBusiness>>>
    ).value;
    fixtures.track({ businessId: created.businessId, userId: created.admin.userId });
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "USERNAME_TAKEN" });
    expect((await businessCount(a.name)) + (await businessCount(b.name))).toBe(1);
  });
});
