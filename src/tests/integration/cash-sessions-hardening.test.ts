import type pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { TestFixtures, createAdminClient } from "./helpers/auth";
import { attempt, createTestPool, withRollback } from "./helpers/db";
import {
  asApiUser,
  createBusiness,
  createMainCashbox,
  createProfile,
  createSubscription,
  resetApiUser,
} from "./helpers/identity";

// F5-T4 (revisión): barreras adicionales de la jornada: correcciones, espejos, gasto del cobrador, cobros del
// cobrador siempre en jornada, aislamiento entre negocios y entre cobradores, y saldo concurrente.

const pool = createTestPool();
const fixtures = new TestFixtures(pool, createAdminClient());

afterAll(async () => {
  await fixtures.purge();
  await pool.end();
});

const CHECK_VIOLATION = "23514";

let counter = 0;
const next = () => ++counter;

type World = Awaited<ReturnType<typeof world>>;

async function world(client: pg.PoolClient, funds = 1000) {
  const business = await createBusiness(client, `Negocio ${next()}`);
  await createSubscription(client, business);
  const box = await createMainCashbox(client, business);
  const admin = await createProfile(client, {
    role: "ADMIN_NEGOCIO",
    businessId: business,
    username: `admin.${next()}`,
  });
  const collectorUser = await createProfile(client, {
    role: "COBRADOR",
    businessId: business,
    username: `cob.${next()}`,
  });
  const collector = (
    await client.query<{ id: string }>(
      "insert into public.collectors (business_id, user_id, name, created_by) values ($1, $2, 'C', $3) returning id",
      [business, collectorUser, admin],
    )
  ).rows[0]!.id;
  const route = (
    await client.query<{ id: string }>(
      "insert into public.routes (business_id, collector_id, name, started_on, created_by) values ($1, $2, 'R', current_date, $3) returning id",
      [business, collector, admin],
    )
  ).rows[0]!.id;
  const clientId = (
    await client.query<{ id: string }>(
      "insert into public.clients (business_id, name, identification, created_by) values ($1, 'Ana', $2, $3) returning id",
      [business, `id-${next()}`, admin],
    )
  ).rows[0]!.id;
  await client.query(
    "insert into public.client_assignments (business_id, client_id, route_id, collector_id, created_by) values ($1, $2, $3, $4, $5)",
    [business, clientId, route, collector, admin],
  );
  const contract = (
    await client.query<{ id: string }>(
      "insert into public.contracts (business_id, client_id, number, origin, created_by) values ($1, $2, 'CT-000001', 'NUEVO', $3) returning id",
      [business, clientId, admin],
    )
  ).rows[0]!.id;
  const loanId = (
    await client.query<{ id: string }>(
      `insert into public.loans
         (business_id, contract_id, principal_amount, interest_bps, interest_amount, total_amount,
          scheduled_amount, disbursed_on, first_due_on, frequency, installment_count, created_by)
       values ($1, $2, 300, 0, 0, 300, 300, '2026-10-13', '2026-10-14', 'DIARIA', 1, $3) returning id`,
      [business, contract, admin],
    )
  ).rows[0]!.id;
  const installment = (
    await client.query<{ id: string }>(
      "insert into public.installments (business_id, loan_id, number, due_on, amount) values ($1, $2, 1, '2026-10-14', 300) returning id",
      [business, loanId],
    )
  ).rows[0]!.id;
  const w = {
    business,
    box,
    admin,
    collectorUser,
    collector,
    loanId,
    installment,
    route,
    clientId,
  };
  await mayor(client, w, "INGRESO_CAPITAL", "ENTRADA", funds);
  return w;
}

async function mayor(
  client: pg.PoolClient,
  w: { business: string; box: string; admin: string },
  type: string,
  direction: string,
  amount: number,
  extra: { session?: string; reverses?: string; reason?: string; by?: string } = {},
) {
  return (
    await client.query<{ id: string }>(
      `insert into public.cash_movements
         (business_id, cashbox_id, type, direction, amount, reference_type, reference_id, reverses_movement_id, reason, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
      [
        w.business,
        w.box,
        type,
        direction,
        amount,
        extra.session ? "session" : null,
        extra.session ?? null,
        extra.reverses ?? null,
        extra.reason ?? null,
        extra.by ?? w.admin,
      ],
    )
  ).rows[0]!.id;
}

async function menor(
  client: pg.PoolClient,
  w: World,
  session: string,
  type: string,
  direction: string,
  amount: number,
  by?: string,
) {
  const mirrored = type === "FONDO_OPERATIVO" || type === "LIQUIDACION";
  return (
    await client.query<{ id: string }>(
      `insert into public.cash_movements
         (business_id, cashbox_id, session_id, type, direction, amount, reference_type, reference_id, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
      [
        w.business,
        w.box,
        session,
        type,
        direction,
        amount,
        mirrored ? "session" : null,
        mirrored ? session : null,
        by ?? w.collectorUser,
      ],
    )
  ).rows[0]!.id;
}

const openSession = async (client: pg.PoolClient, w: World) =>
  (
    await client.query<{ id: string }>(
      "insert into public.cash_sessions (business_id, collector_id, business_date) values ($1, $2, current_date) returning id",
      [w.business, w.collector],
    )
  ).rows[0]!.id;

async function fund(client: pg.PoolClient, w: World, session: string, amount: number) {
  await mayor(client, w, "FONDO_OPERATIVO", "SALIDA", amount, { session });
  await menor(client, w, session, "FONDO_OPERATIVO", "ENTRADA", amount, w.admin);
}

/** Declara y liquida una jornada cuadrada con lo que tenga. */
async function closeSession(client: pg.PoolClient, w: World, session: string, amount: number) {
  await client.query(
    "insert into public.settlements (business_id, session_id, collector_id, declared_amount, declared_by) values ($1, $2, $3, $4, $5)",
    [w.business, session, w.collector, amount, w.collectorUser],
  );
  await client.query(
    "update public.cash_sessions set status = 'PENDIENTE_LIQUIDACION', declared_at = now() where id = $1",
    [session],
  );
  await mayor(client, w, "LIQUIDACION", "ENTRADA", amount, { session });
  await menor(client, w, session, "LIQUIDACION", "SALIDA", amount, w.admin);
  await client.query(
    `update public.settlements set status = 'CUADRADA', expected_amount = $2, received_amount = $2,
            difference = 0, confirmed_by = $3, confirmed_at = now() where session_id = $1`,
    [session, amount, w.admin],
  );
  await client.query(
    "update public.cash_sessions set status = 'LIQUIDADA', closed_at = now() where id = $1",
    [session],
  );
}

const check = (client: pg.PoolClient) => attempt(client, "set constraints all immediate");

describe("correcciones y barreras de la jornada", () => {
  it("un cobro de una jornada ya liquidada se corrige con un reverso de la Mayor; el fondo no se reversa", async () => {
    await withRollback(pool, async (client) => {
      const w = await world(client);
      const session = await openSession(client, w);
      await fund(client, w, session, 100);
      const collected = await menor(client, w, session, "COBRO", "ENTRADA", 40);
      const fundMovement = (
        await client.query<{ id: string }>(
          "select id from public.cash_movements where session_id = $1 and type = 'FONDO_OPERATIVO'",
          [session],
        )
      ).rows[0]!.id;

      const reverseInMayor = (original: string, direction: string, amount: number) =>
        attempt(
          client,
          "insert into public.cash_movements (business_id, cashbox_id, type, direction, amount, reason, reverses_movement_id, created_by) values ($1, $2, 'REVERSO', $3, $4, 'Error', $5, $6)",
          [w.business, w.box, direction, amount, original, w.admin],
        );
      // Con la jornada abierta, el cobro se reversa en la jornada, no en la Mayor.
      expect((await reverseInMayor(collected, "SALIDA", 40))?.code).toBe(CHECK_VIOLATION);

      await closeSession(client, w, session, 140);
      // El fondo y la liquidación no se reversan: crearían o destruirían dinero.
      expect((await reverseInMayor(fundMovement, "ENTRADA", 100))?.code).toBe(CHECK_VIOLATION);
      // Con la jornada liquidada, el cobro se corrige contra la Mayor.
      expect(await reverseInMayor(collected, "SALIDA", 40)).toBeNull();
      expect(await check(client)).toBeNull();
    });
  });

  it("un cobrador no cobra en la Caja Mayor y el gasto del cobrador debe coincidir con su movimiento", async () => {
    await withRollback(pool, async (client) => {
      const w = await world(client);
      const session = await openSession(client, w);
      await fund(client, w, session, 100);

      const own = await mayor(client, w, "COBRO", "ENTRADA", 10, { by: w.collectorUser });
      expect(
        (
          await attempt(
            client,
            "insert into public.payments (business_id, loan_id, kind, amount, movement_id, registered_by) values ($1, $2, 'CUOTAS', 10, $3, $4)",
            [w.business, w.loanId, own, w.collectorUser],
          )
        )?.code,
      ).toBe(CHECK_VIOLATION);

      const spent = await menor(client, w, session, "GASTO_COBRADOR", "SALIDA", 20);
      const other = await menor(client, w, session, "GASTO_COBRADOR", "SALIDA", 20);
      const insertExpense = (movement: string, sessionId: string | null) =>
        attempt(
          client,
          "insert into public.expenses (business_id, cashbox_id, session_id, movement_id, category, amount, spent_on, created_by) values ($1, $2, $3, $4, 'GASOLINA', 20, current_date, $5)",
          [w.business, w.box, sessionId, movement, w.collectorUser],
        );
      expect(await insertExpense(spent, session)).toBeNull();
      // Un gasto sin jornada no puede apuntar al gasto del cobrador.
      expect((await insertExpense(other, null))?.code).toBe(CHECK_VIOLATION);
    });
  });

  it("un movimiento de la Mayor no se cuadra con la jornada de otro negocio", async () => {
    await withRollback(pool, async (client) => {
      const a = await world(client);
      const b = await world(client);
      const sessionB = await openSession(client, b);
      expect(
        (
          await attempt(
            client,
            "insert into public.cash_movements (business_id, cashbox_id, type, direction, amount, reference_type, reference_id, created_by) values ($1, $2, 'FONDO_OPERATIVO', 'SALIDA', 10, 'session', $3, $4)",
            [a.business, a.box, sessionB, a.admin],
          )
        )?.code,
      ).toBe(CHECK_VIOLATION);
      expect(
        (
          await attempt(
            client,
            "insert into public.cash_movements (business_id, cashbox_id, session_id, type, direction, amount, created_by) values ($1, $2, $3, 'GASTO_COBRADOR', 'SALIDA', 1, $4)",
            [a.business, a.box, sessionB, a.collectorUser],
          )
        )?.code,
      ).toBe(CHECK_VIOLATION);
    });
  });

  it("un cobrador no ve los movimientos ni la jornada de otro cobrador del mismo negocio", async () => {
    await withRollback(pool, async (client) => {
      const w = await world(client);
      const sessionOne = await openSession(client, w);
      await fund(client, w, sessionOne, 50);
      const otherUser = await createProfile(client, {
        role: "COBRADOR",
        businessId: w.business,
        username: `cob.${next()}`,
      });
      const other = (
        await client.query<{ id: string }>(
          "insert into public.collectors (business_id, user_id, name, created_by) values ($1, $2, 'Otro', $3) returning id",
          [w.business, otherUser, w.admin],
        )
      ).rows[0]!.id;
      const sessionTwo = (
        await client.query<{ id: string }>(
          "insert into public.cash_sessions (business_id, collector_id, business_date) values ($1, $2, current_date) returning id",
          [w.business, other],
        )
      ).rows[0]!.id;
      await menor(client, w, sessionTwo, "COBRO", "ENTRADA", 7, otherUser);

      await asApiUser(client, { sub: otherUser, app_role: "COBRADOR", business_id: w.business });
      const rows = await client.query<{ session_id: string }>(
        "select session_id from public.cash_movements",
      );
      expect(rows.rows.map((r) => r.session_id)).toEqual([sessionTwo]);
      const sessions = await client.query<{ id: string }>("select id from public.cash_sessions");
      expect(sessions.rows.map((r) => r.id)).toEqual([sessionTwo]);
      await resetApiUser(client);
    });
  });
});

describe("saldo concurrente", () => {
  it("dos gastos simultáneos de una jornada no la dejan en negativo", async () => {
    const businessId = await fixtures.business("Saldo concurrente");
    const admin = await fixtures.account({ role: "ADMIN_NEGOCIO", businessId });
    const user = await fixtures.account({ role: "COBRADOR", businessId });
    const collector = (
      await pool.query<{ id: string }>(
        "insert into public.collectors (business_id, user_id, name, created_by) values ($1, $2, 'C', $3) returning id",
        [businessId, user.userId, admin.userId],
      )
    ).rows[0]!.id;
    const session = (
      await pool.query<{ id: string }>(
        "insert into public.cash_sessions (business_id, collector_id, business_date) values ($1, $2, current_date) returning id",
        [businessId, collector],
      )
    ).rows[0]!.id;
    const box = (
      await pool.query<{ id: string }>(
        "select id from public.main_cashboxes where business_id = $1",
        [businessId],
      )
    ).rows[0]!.id;
    const setup = await pool.connect();
    try {
      await setup.query("begin");
      await setup.query(
        `insert into public.cash_movements (business_id, cashbox_id, type, direction, amount, created_by)
         values ($1, $2, 'INGRESO_CAPITAL', 'ENTRADA', 1000, $3)`,
        [businessId, box, admin.userId],
      );
      await setup.query(
        `insert into public.cash_movements (business_id, cashbox_id, type, direction, amount, reference_type, reference_id, created_by)
         values ($1, $2, 'FONDO_OPERATIVO', 'SALIDA', 100, 'session', $3, $4)`,
        [businessId, box, session, admin.userId],
      );
      await setup.query(
        `insert into public.cash_movements (business_id, cashbox_id, session_id, type, direction, amount, reference_type, reference_id, created_by)
         values ($1, $2, $3, 'FONDO_OPERATIVO', 'ENTRADA', 100, 'session', $3, $4)`,
        [businessId, box, session, admin.userId],
      );
      await setup.query("commit");
    } finally {
      setup.release();
    }

    const spend = async (client: pg.PoolClient) => {
      await client.query(
        `insert into public.cash_movements (business_id, cashbox_id, session_id, type, direction, amount, created_by)
         values ($1, $2, $3, 'GASTO_COBRADOR', 'SALIDA', 70, $4)`,
        [businessId, box, session, user.userId],
      );
      await client.query("commit");
    };
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      await a.query("begin");
      await b.query("begin");
      const results = await Promise.allSettled([spend(a), spend(b)]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const balance = await pool.query<{ n: string }>(
        `select coalesce(sum(case direction when 'ENTRADA' then amount else -amount end), 0)::text as n
           from public.cash_movements where session_id = $1`,
        [session],
      );
      expect(Number(balance.rows[0]!.n)).toBe(30);
    } finally {
      await a.query("rollback").catch(() => undefined);
      await b.query("rollback").catch(() => undefined);
      a.release();
      b.release();
    }
  });
});
