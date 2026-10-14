import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { TestFixtures, createAdminClient } from "./helpers/auth";
import { createTestPool, sleep } from "./helpers/db";

// F5-T2 (revisión): las invariantes de cobradores, rutas y asignaciones se sostienen con operaciones
// simultáneas reales (dos conexiones y transacciones sin confirmar), no solo en secuencia.

const pool = createTestPool();
const fixtures = new TestFixtures(pool, createAdminClient());

afterAll(async () => {
  await fixtures.purge();
  await pool.end();
});

const CHECK_VIOLATION = "23514";

async function world(plan = "MENSUAL") {
  const businessId = await fixtures.business("Concurrencia cobradores");
  await pool.query("update public.subscriptions set plan_code = $2 where business_id = $1", [
    businessId,
    plan,
  ]);
  const admin = await fixtures.account({ role: "ADMIN_NEGOCIO", businessId });
  const collector = async (status: "ACTIVO" | "INACTIVO" = "ACTIVO") => {
    const user = await fixtures.account({ role: "COBRADOR", businessId });
    const { rows } = await pool.query<{ id: string }>(
      `insert into public.collectors (business_id, user_id, name, status, created_by)
       values ($1, $2, 'Cobrador', $3, $4) returning id`,
      [businessId, user.userId, status, admin.userId],
    );
    return rows[0]!.id;
  };
  return { businessId, admin: admin.userId, collector };
}

/** Dos conexiones: `first` deja su transacción abierta, `second` se bloquea y se resuelve al confirmar la primera. */
async function race(
  first: (client: pg.PoolClient) => Promise<unknown>,
  second: (client: pg.PoolClient) => Promise<unknown>,
): Promise<{ code?: string; error?: unknown; ok: boolean }> {
  const a = await pool.connect();
  const b = await pool.connect();
  try {
    await a.query("begin");
    await first(a);
    await b.query("begin");
    const pending = second(b).then(
      () => ({ ok: true }) as { code?: string; error?: unknown; ok: boolean },
      (error: { code?: string }) => ({ ok: false, code: error.code, error }),
    );
    // Si `second` no estuviera bloqueado ya habría terminado: se le da tiempo y luego se confirma la primera.
    await sleep(300);
    await a.query("commit");
    const outcome = await pending;
    await b.query("rollback");
    return outcome;
  } finally {
    a.release();
    b.release();
  }
}

describe("concurrencia de cobradores, rutas y asignaciones", () => {
  it("dos activaciones simultáneas en el límite del plan: solo una entra", async () => {
    const w = await world("SEMANAL");
    for (let i = 0; i < 4; i++) await w.collector();
    const x = await w.collector("INACTIVO");
    const y = await w.collector("INACTIVO");

    const outcome = await race(
      (a) => a.query("update public.collectors set status = 'ACTIVO' where id = $1", [x]),
      (b) => b.query("update public.collectors set status = 'ACTIVO' where id = $1", [y]),
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe(CHECK_VIOLATION);
    const active = await pool.query<{ n: string }>(
      "select count(*)::text as n from public.collectors where business_id = $1 and status = 'ACTIVO'",
      [w.businessId],
    );
    expect(active.rows[0]!.n).toBe("5");
  });

  it("cambiar de plan contra una activación simultánea no deja más activos que el tope", async () => {
    const w = await world("MENSUAL");
    for (let i = 0; i < 5; i++) await w.collector();
    const sixth = await w.collector("INACTIVO");

    const outcome = await race(
      (a) => a.query("update public.collectors set status = 'ACTIVO' where id = $1", [sixth]),
      (b) =>
        b.query("update public.subscriptions set plan_code = 'SEMANAL' where business_id = $1", [
          w.businessId,
        ]),
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe(CHECK_VIOLATION);
  });

  it("cerrar una ruta contra una asignación simultánea: no queda ruta cerrada con clientes", async () => {
    const w = await world();
    const collectorId = await w.collector();
    const route = (
      await pool.query<{ id: string }>(
        `insert into public.routes (business_id, collector_id, name, started_on, created_by)
         values ($1, $2, 'R', current_date, $3) returning id`,
        [w.businessId, collectorId, w.admin],
      )
    ).rows[0]!.id;
    const clientId = (
      await pool.query<{ id: string }>(
        "insert into public.clients (business_id, name, identification, created_by) values ($1, 'Ana', $2, $3) returning id",
        [w.businessId, randomUUID().slice(0, 8), w.admin],
      )
    ).rows[0]!.id;

    const outcome = await race(
      (a) =>
        a.query(
          "insert into public.client_assignments (business_id, client_id, route_id, collector_id, created_by) values ($1, $2, $3, $4, $5)",
          [w.businessId, clientId, route, collectorId, w.admin],
        ),
      (b) =>
        b.query("update public.routes set status = 'CERRADA', closed_at = now() where id = $1", [
          route,
        ]),
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe(CHECK_VIOLATION);
    const state = await pool.query<{ route: string; assignment: string }>(
      `select (select status from public.routes where id = $1) as route,
              (select status from public.client_assignments where route_id = $1) as assignment`,
      [route],
    );
    expect(state.rows[0]).toEqual({ route: "ACTIVA", assignment: "ACTIVA" });
  });

  it("desactivar un cobrador contra una ruta simultánea: no queda inactivo con ruta activa", async () => {
    const w = await world();
    const collectorId = await w.collector();

    const outcome = await race(
      (a) =>
        a.query(
          `insert into public.routes (business_id, collector_id, name, started_on, created_by)
           values ($1, $2, 'R', current_date, $3)`,
          [w.businessId, collectorId, w.admin],
        ),
      (b) =>
        b.query("update public.collectors set status = 'INACTIVO' where id = $1", [collectorId]),
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe(CHECK_VIOLATION);
    const state = await pool.query<{ status: string }>(
      "select status from public.collectors where id = $1",
      [collectorId],
    );
    expect(state.rows[0]!.status).toBe("ACTIVO");
  });
});
