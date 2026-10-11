import type { PoolClient } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { signInWithUsername } from "@/modules/identity/login";
import { loadSessionContext, type SessionContext } from "@/modules/identity/session";
import {
  activateBusiness,
  archiveBusiness,
  changePlan,
  resubscribeBusiness,
  suspendBusiness,
  type LifecycleDeps,
} from "@/modules/subscriptions/lifecycle";
import { AppError } from "@/shared/errors/app-error";
import {
  TEST_EMAIL_DOMAIN,
  TestFixtures,
  createAdminClient,
  createAnonClient,
} from "./helpers/auth";
import { attempt, createTestPool } from "./helpers/db";

// 02-DOMINIO §1.2–1.3 y ADR 0003/0005: suspender, activar, archivar, cambiar de plan y re-suscribir.
// El estado de acceso del negocio y el de la suscripción vigente cambian siempre en una transacción.

const pool = createTestPool();
const fixtures = new TestFixtures(pool, createAdminClient());

afterAll(async () => {
  await fixtures.purge();
  await pool.end();
});

const deps = (overrides: Partial<LifecycleDeps> = {}): LifecycleDeps => ({
  db: pool,
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

type SubscriptionRow = {
  id: string;
  plan_code: string;
  status: string;
  starts_on: string;
  expires_on: string;
  note: string | null;
  changed_by: string | null;
};

async function businessAccess(businessId: string): Promise<string> {
  const { rows } = await pool.query<{ access_status: string }>(
    "select access_status from public.businesses where id = $1",
    [businessId],
  );
  return rows[0]!.access_status;
}

async function subscriptions(businessId: string): Promise<SubscriptionRow[]> {
  const { rows } = await pool.query<SubscriptionRow>(
    `select id, plan_code, status, starts_on::text, expires_on::text, note, changed_by
       from public.subscriptions where business_id = $1 order by created_at, id`,
    [businessId],
  );
  return rows;
}

async function auditOf(businessId: string, action?: string) {
  const { rows } = await pool.query<{
    action: string;
    actor_id: string | null;
    entity_type: string;
    entity_id: string;
    result: string;
    summary: Record<string, unknown>;
  }>(
    `select action, actor_id, entity_type, entity_id, result, summary
       from public.audit_events
      where business_id = $1 and ($2::text is null or action = $2) order by occurred_at, action`,
    [businessId, action ?? null],
  );
  return rows;
}

const canLogin = async (account: { username: string; password: string }) => {
  try {
    await signInWithUsername(
      { supabase: createAnonClient(), db: pool, syntheticEmailDomain: TEST_EMAIL_DOMAIN },
      account,
    );
    return true;
  } catch (error) {
    if (error instanceof AppError) return false;
    throw error;
  }
};

/** Negocio con su suscripción MENSUAL ACTIVA, una cuenta admin ACTIVA y un Super Admin que opera. */
async function setup() {
  const businessId = await fixtures.business();
  const admin = await fixtures.account({ role: "ADMIN_NEGOCIO", businessId });
  const actor = await superAdmin();
  return { businessId, admin, actor };
}

describe("suspender y activar", () => {
  it("suspender bloquea acceso y suscripción juntos, audita y corta el login del admin", async () => {
    const { businessId, admin, actor } = await setup();
    expect(await canLogin(admin)).toBe(true);

    const result = await suspendBusiness(deps(), actor, { businessId, note: "Falta de pago" });

    expect(result).toMatchObject({
      businessId,
      accessStatus: "SUSPENDIDO",
      subscription: { status: "SUSPENDIDA", planCode: "MENSUAL" },
    });
    expect(await businessAccess(businessId)).toBe("SUSPENDIDO");
    const [sub] = await subscriptions(businessId);
    expect(sub).toMatchObject({
      status: "SUSPENDIDA",
      note: "Falta de pago",
      changed_by: actor.userId,
    });

    const [event] = await auditOf(businessId, "NegocioSuspendido");
    expect(event).toMatchObject({
      actor_id: actor.userId,
      entity_type: "business",
      entity_id: businessId,
      result: "OK",
    });
    expect(event?.summary).toMatchObject({
      from: { accessStatus: "ACTIVO", subscriptionStatus: "ACTIVA" },
      to: { accessStatus: "SUSPENDIDO", subscriptionStatus: "SUSPENDIDA" },
      note: "Falta de pago",
    });

    expect(await canLogin(admin)).toBe(false);
    expect(await failureOf(loadSessionContext(admin.userId, pool))).toMatchObject({
      code: "BUSINESS_SUSPENDED",
    });
  });

  it("activar restablece ambos estados y el acceso; las cuentas nunca se tocaron", async () => {
    const { businessId, admin, actor } = await setup();
    await suspendBusiness(deps(), actor, { businessId });

    await activateBusiness(deps(), actor, { businessId, note: "Pagó" });

    expect(await businessAccess(businessId)).toBe("ACTIVO");
    expect((await subscriptions(businessId))[0]).toMatchObject({ status: "ACTIVA", note: "Pagó" });
    expect(await auditOf(businessId, "NegocioActivado")).toHaveLength(1);
    expect(await canLogin(admin)).toBe(true);
  });

  it("la observación es opcional y no borra la anterior", async () => {
    const { businessId, actor } = await setup();

    await suspendBusiness(deps(), actor, { businessId, note: "Motivo uno" });
    await activateBusiness(deps(), actor, { businessId });

    expect((await subscriptions(businessId))[0]?.note).toBe("Motivo uno");
  });

  it("rechaza transiciones inválidas con 409, sin cambiar nada ni auditar", async () => {
    const { businessId, actor } = await setup();

    expect(await failureOf(activateBusiness(deps(), actor, { businessId }))).toMatchObject({
      code: "INVALID_STATE_TRANSITION",
      status: 409,
    });
    await suspendBusiness(deps(), actor, { businessId });
    expect(await failureOf(suspendBusiness(deps(), actor, { businessId }))).toMatchObject({
      code: "INVALID_STATE_TRANSITION",
    });

    expect(await auditOf(businessId, "NegocioSuspendido")).toHaveLength(1);
    expect(await auditOf(businessId, "NegocioActivado")).toHaveLength(0);
  });

  it("un negocio inexistente es 404", async () => {
    const actor = await superAdmin();

    expect(
      await failureOf(suspendBusiness(deps(), actor, { businessId: crypto.randomUUID() })),
    ).toMatchObject({ code: "BUSINESS_NOT_FOUND", status: 404 });
  });

  it("dos suspensiones simultáneas: una se aplica y la otra es 409 (bloqueo de fila)", async () => {
    const { businessId, actor } = await setup();

    const results = await Promise.allSettled([
      suspendBusiness(deps(), actor, { businessId }),
      suspendBusiness(deps(), actor, { businessId }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(await auditOf(businessId, "NegocioSuspendido")).toHaveLength(1);
  });
});

describe("archivar y re-suscribir", () => {
  it("archivar exige motivo, deja ARCHIVADA y bloquea el acceso; las cuentas sobreviven", async () => {
    const { businessId, admin, actor } = await setup();

    for (const reason of ["", "   "]) {
      expect(await failureOf(archiveBusiness(deps(), actor, { businessId, reason }))).toMatchObject(
        {
          code: "REASON_REQUIRED",
          status: 400,
        },
      );
    }
    expect(await businessAccess(businessId)).toBe("ACTIVO");

    await archiveBusiness(deps(), actor, { businessId, reason: "  Cierre definitivo  " });

    expect(await businessAccess(businessId)).toBe("SUSPENDIDO");
    expect((await subscriptions(businessId))[0]).toMatchObject({
      status: "ARCHIVADA",
      note: "Cierre definitivo",
    });
    const [event] = await auditOf(businessId, "NegocioArchivado");
    expect(event?.summary).toMatchObject({ reason: "Cierre definitivo" });
    expect(await canLogin(admin)).toBe(false);
    const profile = await pool.query("select 1 from public.profiles where id = $1", [admin.userId]);
    expect(profile.rowCount).toBe(1);
  });

  it("también se archiva desde SUSPENDIDA", async () => {
    const { businessId, actor } = await setup();
    await suspendBusiness(deps(), actor, { businessId });

    await archiveBusiness(deps(), actor, { businessId, reason: "Baja" });

    expect((await subscriptions(businessId))[0]?.status).toBe("ARCHIVADA");
  });

  it("un negocio archivado no admite suspender, activar, archivar ni cambiar plan", async () => {
    const { businessId, actor } = await setup();
    await archiveBusiness(deps(), actor, { businessId, reason: "Baja" });

    // Funciones que crean la promesa al ejecutarse: así cada rechazo se espera donde se produce.
    const attempts = [
      () => suspendBusiness(deps(), actor, { businessId }),
      () => activateBusiness(deps(), actor, { businessId }),
      () => archiveBusiness(deps(), actor, { businessId, reason: "Otra vez" }),
      () => changePlan(deps(), actor, { businessId, planCode: "ANUAL" }),
    ];
    for (const attemptCommand of attempts) {
      expect(await failureOf(attemptCommand())).toMatchObject({
        code: "INVALID_STATE_TRANSITION",
        status: 409,
      });
    }
    expect(await subscriptions(businessId)).toHaveLength(1);
  });

  it("re-suscribir crea una suscripción nueva desde hoy y deja la archivada intacta", async () => {
    const { businessId, admin, actor } = await setup();
    await archiveBusiness(deps(), actor, { businessId, reason: "Baja" });
    const [archivedBefore] = await subscriptions(businessId);
    const now = () => new Date("2026-10-11T15:00:00Z");

    const result = await resubscribeBusiness(deps({ now }), actor, {
      businessId,
      planCode: "SEMANAL",
      note: "Vuelve el cliente",
    });

    expect(result).toMatchObject({
      accessStatus: "ACTIVO",
      subscription: {
        planCode: "SEMANAL",
        status: "ACTIVA",
        startsOn: "2026-10-11",
        expiresOn: "2026-10-18",
      },
    });
    expect(await businessAccess(businessId)).toBe("ACTIVO");

    const rows = await subscriptions(businessId);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(archivedBefore);
    expect(rows[1]).toMatchObject({
      plan_code: "SEMANAL",
      status: "ACTIVA",
      starts_on: "2026-10-11",
      note: "Vuelve el cliente",
      changed_by: actor.userId,
    });

    const [created] = await auditOf(businessId, "SuscripcionCreada");
    expect(created).toMatchObject({
      entity_type: "subscription",
      entity_id: result.subscription.id,
    });
    expect(created?.summary).toMatchObject({
      planCode: "SEMANAL",
      previous: { planCode: "MENSUAL", status: "ARCHIVADA", startsOn: archivedBefore!.starts_on },
    });
    expect(await auditOf(businessId, "NegocioActivado")).toHaveLength(1);
    expect(await canLogin(admin)).toBe(true);
  });

  it("solo se re-suscribe un negocio archivado", async () => {
    const { businessId, actor } = await setup();

    expect(
      await failureOf(resubscribeBusiness(deps(), actor, { businessId, planCode: "ANUAL" })),
    ).toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    await suspendBusiness(deps(), actor, { businessId });
    expect(
      await failureOf(resubscribeBusiness(deps(), actor, { businessId, planCode: "ANUAL" })),
    ).toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(await subscriptions(businessId)).toHaveLength(1);
  });

  it("puede archivarse y re-suscribirse más de una vez: queda el historial completo", async () => {
    const { businessId, actor } = await setup();

    await archiveBusiness(deps(), actor, { businessId, reason: "Primera baja" });
    await resubscribeBusiness(deps(), actor, { businessId, planCode: "MENSUAL" });
    await archiveBusiness(deps(), actor, { businessId, reason: "Segunda baja" });
    await resubscribeBusiness(deps(), actor, { businessId, planCode: "ANUAL" });

    const rows = await subscriptions(businessId);
    expect(rows.map((row) => row.status)).toEqual(["ARCHIVADA", "ARCHIVADA", "ACTIVA"]);
    expect(rows.map((row) => row.plan_code)).toEqual(["MENSUAL", "MENSUAL", "ANUAL"]);
  });

  it("dos re-suscripciones simultáneas crean una sola suscripción vigente", async () => {
    const { businessId, actor } = await setup();
    await archiveBusiness(deps(), actor, { businessId, reason: "Baja" });

    const results = await Promise.allSettled([
      resubscribeBusiness(deps(), actor, { businessId, planCode: "MENSUAL" }),
      resubscribeBusiness(deps(), actor, { businessId, planCode: "ANUAL" }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rows = await subscriptions(businessId);
    expect(rows.filter((row) => row.status !== "ARCHIVADA")).toHaveLength(1);
  });
});

describe("cambiar de plan", () => {
  it("reinicia inicio y vencimiento desde hoy, conserva el estado y audita antes y después", async () => {
    const { businessId, actor } = await setup();
    const [before] = await subscriptions(businessId);
    const now = () => new Date("2026-10-11T15:00:00Z");

    const result = await changePlan(deps({ now }), actor, {
      businessId,
      planCode: "SEMANAL",
      note: "Baja de plan",
    });

    expect(result.subscription).toMatchObject({
      id: before!.id,
      planCode: "SEMANAL",
      status: "ACTIVA",
      startsOn: "2026-10-11",
      expiresOn: "2026-10-18",
    });
    const rows = await subscriptions(businessId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      plan_code: "SEMANAL",
      note: "Baja de plan",
      changed_by: actor.userId,
    });

    const [event] = await auditOf(businessId, "PlanCambiado");
    expect(event).toMatchObject({ entity_type: "subscription", entity_id: before!.id });
    expect(event?.summary).toMatchObject({
      from: { planCode: "MENSUAL", startsOn: before!.starts_on, expiresOn: before!.expires_on },
      to: { planCode: "SEMANAL", startsOn: "2026-10-11", expiresOn: "2026-10-18" },
    });
    expect(await businessAccess(businessId)).toBe("ACTIVO");
  });

  it("una suscripción suspendida sigue suspendida tras cambiar de plan", async () => {
    const { businessId, actor } = await setup();
    await suspendBusiness(deps(), actor, { businessId });

    await changePlan(deps(), actor, { businessId, planCode: "ANUAL" });

    expect((await subscriptions(businessId))[0]).toMatchObject({
      plan_code: "ANUAL",
      status: "SUSPENDIDA",
    });
    expect(await businessAccess(businessId)).toBe("SUSPENDIDO");
  });

  it("elegir el mismo plan reinicia el período (renovación) y queda auditado", async () => {
    const { businessId, actor } = await setup();
    const now = () => new Date("2027-01-31T12:00:00Z");

    const result = await changePlan(deps({ now }), actor, { businessId, planCode: "MENSUAL" });

    expect(result.subscription).toMatchObject({ startsOn: "2027-01-31", expiresOn: "2027-02-28" });
    expect(await auditOf(businessId, "PlanCambiado")).toHaveLength(1);
  });

  it("las fechas siguen la zona horaria del negocio, no UTC", async () => {
    const { businessId, actor } = await setup();
    await pool.query("update public.businesses set time_zone = 'Pacific/Auckland' where id = $1", [
      businessId,
    ]);
    // 23:00 UTC del 27 ya es el 28 en Auckland.
    const now = () => new Date("2026-10-27T23:00:00Z");

    const result = await changePlan(deps({ now }), actor, { businessId, planCode: "SEMANAL" });

    expect(result.subscription.startsOn).toBe("2026-10-28");
  });

  it("rechaza un plan desconocido sin tocar nada", async () => {
    const { businessId, actor } = await setup();

    expect(
      await failureOf(changePlan(deps(), actor, { businessId, planCode: "TRIMESTRAL" as never })),
    ).toMatchObject({ code: "INVALID_PLAN", status: 400 });
    expect(await auditOf(businessId, "PlanCambiado")).toHaveLength(0);
  });
});

describe("autorización", () => {
  it("un admin o un cobrador no pueden operar: 403, sin cambios y con evento RECHAZADO", async () => {
    const { businessId, admin } = await setup();
    const otherBusiness = await fixtures.business();
    const accounts = [
      admin, // el propio admin del negocio tampoco puede suspenderlo
      await fixtures.account({ role: "COBRADOR", businessId }),
      await fixtures.account({ role: "ADMIN_NEGOCIO", businessId: otherBusiness }),
      await fixtures.account({ role: "COBRADOR", businessId: otherBusiness }),
    ];

    for (const account of accounts) {
      const actor = await loadSessionContext(account.userId, pool);
      expect(
        await failureOf(suspendBusiness(deps(), actor, { businessId })),
        actor.role,
      ).toMatchObject({
        code: "FORBIDDEN",
        status: 403,
      });
    }

    expect(await businessAccess(businessId)).toBe("ACTIVO");
    expect((await subscriptions(businessId))[0]?.status).toBe("ACTIVA");
    const rejected = (await auditOf(businessId)).filter((event) => event.result === "RECHAZADO");
    expect(rejected).toHaveLength(accounts.length);
    expect(rejected.every((event) => event.action === "NegocioSuspendido")).toBe(true);
    expect(rejected.every((event) => event.entity_id === businessId)).toBe(true);
    expect(new Set(rejected.map((event) => event.actor_id)).size).toBe(accounts.length);
    expect(JSON.stringify(rejected)).not.toContain("password");
  });

  it("los intentos repetidos del mismo actor no inundan la auditoría: un solo RECHAZADO por minuto", async () => {
    const { businessId } = await setup();
    const intruder = await fixtures.account({ role: "COBRADOR", businessId });
    const actor = await loadSessionContext(intruder.userId, pool);

    for (let i = 0; i < 5; i++) {
      expect(await failureOf(suspendBusiness(deps(), actor, { businessId }))).toMatchObject({
        code: "FORBIDDEN",
      });
    }
    // Otra acción del mismo actor sí es un evento distinto.
    await failureOf(archiveBusiness(deps(), actor, { businessId, reason: "x" }));

    const rejected = (await auditOf(businessId)).filter((event) => event.result === "RECHAZADO");
    expect(rejected.map((event) => event.action).sort()).toEqual([
      "NegocioArchivado",
      "NegocioSuspendido",
    ]);
  });

  it("un intento sobre un negocio inexistente es 403 sin evento (no hay entidad que auditar)", async () => {
    const business = await fixtures.business();
    const account = await fixtures.account({ role: "ADMIN_NEGOCIO", businessId: business });
    const actor = await loadSessionContext(account.userId, pool);
    const ghost = crypto.randomUUID();

    expect(await failureOf(suspendBusiness(deps(), actor, { businessId: ghost }))).toMatchObject({
      code: "FORBIDDEN",
    });
    const { rowCount } = await pool.query(
      "select 1 from public.audit_events where entity_id = $1",
      [ghost],
    );
    expect(rowCount).toBe(0);
  });

  it("un Super Admin con contraseña temporal pendiente no puede, y eso no es un RECHAZADO", async () => {
    const { businessId } = await setup();
    const account = await fixtures.account({
      role: "SUPER_ADMIN",
      businessId: null,
      status: "PENDIENTE_CAMBIO_CONTRASENA",
    });
    const actor = await loadSessionContext(account.userId, pool);

    expect(await failureOf(suspendBusiness(deps(), actor, { businessId }))).toMatchObject({
      code: "PASSWORD_CHANGE_REQUIRED",
    });
    expect(
      (await auditOf(businessId)).filter((event) => event.result === "RECHAZADO"),
    ).toHaveLength(0);
  });
});

describe("atomicidad", () => {
  /** Pool cuyo n-ésimo INSERT en audit_events falla: todo lo anterior de la transacción debe revertirse. */
  function dbFailingAuditInsert(failOnNth: number): LifecycleDeps["db"] {
    return {
      query: pool.query.bind(pool),
      connect: async () => {
        const client = await pool.connect();
        const original = client.query.bind(client) as (...args: unknown[]) => Promise<unknown>;
        let auditInserts = 0;
        client.query = ((text: unknown, ...rest: unknown[]) =>
          typeof text === "string" &&
          text.includes("insert into public.audit_events") &&
          ++auditInserts === failOnNth
            ? Promise.reject(new Error("fallo forzado de auditoría"))
            : original(text, ...rest)) as typeof client.query;
        const release = client.release.bind(client);
        client.release = (() => release(true)) as typeof client.release;
        return client;
      },
    } as unknown as LifecycleDeps["db"];
  }

  it("si falla el registro de auditoría no cambia ni el negocio ni la suscripción", async () => {
    const { businessId, actor } = await setup();

    await expect(
      suspendBusiness({ db: dbFailingAuditInsert(1) }, actor, { businessId }),
    ).rejects.toThrow("fallo forzado");

    expect(await businessAccess(businessId)).toBe("ACTIVO");
    expect((await subscriptions(businessId))[0]?.status).toBe("ACTIVA");
    expect(await auditOf(businessId, "NegocioSuspendido")).toHaveLength(0);
  });

  it("resubscribe revierte la suscripción nueva, el acceso y el primer evento si falla el segundo evento", async () => {
    const { businessId, actor } = await setup();
    await archiveBusiness(deps(), actor, { businessId, reason: "Baja" });
    const before = await subscriptions(businessId);

    await expect(
      resubscribeBusiness({ db: dbFailingAuditInsert(2) }, actor, {
        businessId,
        planCode: "ANUAL",
      }),
    ).rejects.toThrow("fallo forzado");

    expect(await subscriptions(businessId)).toEqual(before);
    expect(await businessAccess(businessId)).toBe("SUSPENDIDO");
    expect(await auditOf(businessId, "SuscripcionCreada")).toHaveLength(0);
    expect(await auditOf(businessId, "NegocioActivado")).toHaveLength(0);
  });

  it("changePlan revierte las fechas y el plan si falla la auditoría", async () => {
    const { businessId, actor } = await setup();
    const before = await subscriptions(businessId);

    await expect(
      changePlan({ db: dbFailingAuditInsert(1) }, actor, { businessId, planCode: "SEMANAL" }),
    ).rejects.toThrow("fallo forzado");

    expect(await subscriptions(businessId)).toEqual(before);
  });
});

describe("invariante de la base de datos con suscripciones archivadas", () => {
  const settle = async (client: PoolClient) => {
    const error = await attempt(client, "set constraints all immediate");
    await client.query("set constraints all deferred");
    return error;
  };
  const CHECK_VIOLATION = "23514";
  const UNIQUE_VIOLATION = "23505";

  async function withArchivedBusiness<T>(
    fn: (client: PoolClient, businessId: string) => Promise<T>,
  ) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const { rows } = await client.query<{ id: string }>(
        `insert into public.businesses (name, owner_name, owner_identification, phone, access_status)
         values ('Invariante', 'R', '1', '3', 'SUSPENDIDO') returning id`,
      );
      const businessId = rows[0]!.id;
      await client.query(
        `insert into public.subscriptions (business_id, plan_code, status, starts_on, expires_on)
         values ($1, 'MENSUAL', 'ARCHIVADA', current_date - 60, current_date - 30)`,
        [businessId],
      );
      return await fn(client, businessId);
    } finally {
      await client.query("rollback");
      client.release();
    }
  }

  it("un negocio solo con suscripciones archivadas debe estar SUSPENDIDO", async () => {
    await withArchivedBusiness(async (client, businessId) => {
      expect(await settle(client)).toBeNull();

      await client.query("update public.businesses set access_status = 'ACTIVO' where id = $1", [
        businessId,
      ]);
      expect((await settle(client))?.code).toBe(CHECK_VIOLATION);
    });
  });

  it("con una vigente ACTIVA junto a la archivada, el negocio ACTIVO es coherente y SUSPENDIDO no", async () => {
    await withArchivedBusiness(async (client, businessId) => {
      await client.query(
        `insert into public.subscriptions (business_id, plan_code, starts_on, expires_on)
         values ($1, 'ANUAL', current_date, current_date + 365)`,
        [businessId],
      );
      await client.query("update public.businesses set access_status = 'ACTIVO' where id = $1", [
        businessId,
      ]);
      expect(await settle(client)).toBeNull();

      await client.query(
        "update public.businesses set access_status = 'SUSPENDIDO' where id = $1",
        [businessId],
      );
      expect((await settle(client))?.code).toBe(CHECK_VIOLATION);
    });
  });

  it("solo puede haber una suscripción vigente (no archivada) por negocio", async () => {
    await withArchivedBusiness(async (client, businessId) => {
      const insertCurrent = (plan: string) =>
        attempt(
          client,
          `insert into public.subscriptions (business_id, plan_code, starts_on, expires_on)
           values ($1, $2, current_date, current_date + 30)`,
          [businessId, plan],
        );

      expect(await insertCurrent("MENSUAL")).toBeNull();
      expect((await insertCurrent("ANUAL"))?.code).toBe(UNIQUE_VIOLATION);
    });
  });

  it("puede haber varias archivadas en el mismo negocio", async () => {
    await withArchivedBusiness(async (client, businessId) => {
      const error = await attempt(
        client,
        `insert into public.subscriptions (business_id, plan_code, status, starts_on, expires_on)
         values ($1, 'ANUAL', 'ARCHIVADA', current_date - 400, current_date - 35)`,
        [businessId],
      );

      expect(error).toBeNull();
    });
  });
});
