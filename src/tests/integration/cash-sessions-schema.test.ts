import type pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { attempt, createTestPool, withRollback } from "./helpers/db";
import {
  asApiUser,
  createBusiness,
  createMainCashbox,
  createProfile,
  createSubscription,
  resetApiUser,
} from "./helpers/identity";

// F5-T4 (02 §5, ADR 0009): jornada de Caja Menor, liquidación y cobros del cobrador. El libro de movimientos
// es de todas las cajas: sin jornada es la Mayor, con jornada es la Menor de esa jornada.

const pool = createTestPool();
afterAll(() => pool.end());

const CHECK_VIOLATION = "23514";
const RESTRICT_VIOLATION = "23001";
const UNIQUE_VIOLATION = "23505";

let counter = 0;
const next = () => ++counter;

type World = Awaited<ReturnType<typeof world>>;

/** Negocio con caja Mayor fondeada, Admin, cobrador activo con ruta, un cliente asignado y su préstamo. */
async function world(client: pg.PoolClient, options: { funds?: number } = {}) {
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
      "insert into public.collectors (business_id, user_id, name, created_by) values ($1, $2, 'Cobrador', $3) returning id",
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
       values ($1, $2, 300, 0, 0, 300, 300, '2026-10-13', '2026-10-14', 'DIARIA', 3, $3) returning id`,
      [business, contract, admin],
    )
  ).rows[0]!.id;
  const installments: string[] = [];
  for (const n of [1, 2, 3]) {
    installments.push(
      (
        await client.query<{ id: string }>(
          "insert into public.installments (business_id, loan_id, number, due_on, amount) values ($1, $2, $3, date '2026-10-14' + ($3::int - 1), 100) returning id",
          [business, loanId, n],
        )
      ).rows[0]!.id,
    );
  }
  const w = {
    business,
    box,
    admin,
    collectorUser,
    collector,
    route,
    clientId,
    loanId,
    installments,
  };
  await mayor(client, w, "INGRESO_CAPITAL", "ENTRADA", options.funds ?? 1000);
  return w;
}

async function mayor(
  client: pg.PoolClient,
  w: { business: string; box: string; admin: string },
  type: string,
  direction: string,
  amount: number,
  extra: { session?: string; reason?: string } = {},
): Promise<string> {
  return (
    await client.query<{ id: string }>(
      `insert into public.cash_movements
         (business_id, cashbox_id, type, direction, amount, reference_type, reference_id, reason, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
      [
        w.business,
        w.box,
        type,
        direction,
        amount,
        extra.session ? "session" : null,
        extra.session ?? null,
        extra.reason ?? null,
        w.admin,
      ],
    )
  ).rows[0]!.id;
}

async function openSession(client: pg.PoolClient, w: World): Promise<string> {
  return (
    await client.query<{ id: string }>(
      "insert into public.cash_sessions (business_id, collector_id, business_date) values ($1, $2, current_date) returning id",
      [w.business, w.collector],
    )
  ).rows[0]!.id;
}

/** Movimiento de la Caja Menor de una jornada. */
async function menor(
  client: pg.PoolClient,
  w: World,
  session: string,
  type: string,
  direction: string,
  amount: number,
  extra: { by?: string; reverses?: string; reason?: string } = {},
): Promise<string> {
  const mirrored = type === "FONDO_OPERATIVO" || type === "LIQUIDACION";
  return (
    await client.query<{ id: string }>(
      `insert into public.cash_movements
         (business_id, cashbox_id, session_id, type, direction, amount, reference_type, reference_id,
          reverses_movement_id, reason, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
      [
        w.business,
        w.box,
        session,
        type,
        direction,
        amount,
        mirrored ? "session" : null,
        mirrored ? session : null,
        extra.reverses ?? null,
        extra.reason ?? null,
        extra.by ?? w.collectorUser,
      ],
    )
  ).rows[0]!.id;
}

/** El Admin transfiere fondo: un movimiento en cada caja. */
async function fund(client: pg.PoolClient, w: World, session: string, amount: number) {
  await mayor(client, w, "FONDO_OPERATIVO", "SALIDA", amount, { session });
  await menor(client, w, session, "FONDO_OPERATIVO", "ENTRADA", amount, { by: w.admin });
}

/** Cobro del cobrador a su cliente: un COBRO en la jornada y el pago aplicado a una cuota. */
async function collect(
  client: pg.PoolClient,
  w: World,
  session: string,
  amount: number,
  by?: string,
) {
  const movementId = await menor(client, w, session, "COBRO", "ENTRADA", amount, { by });
  const { rows } = await client.query<{ id: string }>(
    `insert into public.payments (business_id, loan_id, kind, amount, movement_id, registered_by)
     values ($1, $2, 'CUOTAS', $3, $4, $5) returning id`,
    [w.business, w.loanId, amount, movementId, by ?? w.collectorUser],
  );
  await client.query(
    "insert into public.payment_applications (business_id, payment_id, installment_id, amount, position) values ($1, $2, $3, $4, 1)",
    [w.business, rows[0]!.id, w.installments[0], amount],
  );
  return { paymentId: rows[0]!.id, movementId };
}

async function declare(client: pg.PoolClient, w: World, session: string, amount: number) {
  await client.query(
    "insert into public.settlements (business_id, session_id, collector_id, declared_amount, declared_by) values ($1, $2, $3, $4, $5)",
    [w.business, session, w.collector, amount, w.collectorUser],
  );
  await client.query(
    "update public.cash_sessions set status = 'PENDIENTE_LIQUIDACION', declared_at = now() where id = $1",
    [session],
  );
}

/** Confirma como el comando real: movimientos de cierre, liquidación confirmada y jornada liquidada. */
async function confirm(
  client: pg.PoolClient,
  w: World,
  session: string,
  expected: number,
  received: number,
  observation?: string,
) {
  const difference = expected - received;
  if (received > 0) {
    await mayor(client, w, "LIQUIDACION", "ENTRADA", received, { session });
  }
  if (difference < 0) {
    await menor(client, w, session, "DIFERENCIA_CAJA", "ENTRADA", -difference, { by: w.admin });
  }
  if (received > 0)
    await menor(client, w, session, "LIQUIDACION", "SALIDA", received, { by: w.admin });
  if (difference > 0) {
    await menor(client, w, session, "DIFERENCIA_CAJA", "SALIDA", difference, { by: w.admin });
  }
  await client.query(
    `update public.settlements
        set status = $2, expected_amount = $3, received_amount = $4, difference = $5, observation = $6,
            confirmed_by = $7, confirmed_at = now()
      where session_id = $1`,
    [
      session,
      difference === 0 ? "CUADRADA" : "CON_DIFERENCIA",
      expected,
      received,
      difference,
      observation ?? null,
      w.admin,
    ],
  );
  await client.query(
    "update public.cash_sessions set status = $2, closed_at = now() where id = $1",
    [session, difference === 0 ? "LIQUIDADA" : "LIQUIDADA_CON_DIFERENCIA"],
  );
}

const check = (client: pg.PoolClient) => attempt(client, "set constraints all immediate");
const balance = async (client: pg.PoolClient, session: string | null, w: World) =>
  Number(
    (
      await client.query<{ n: string }>(
        `select coalesce(sum(case direction when 'ENTRADA' then amount else -amount end), 0)::text as n
           from public.cash_movements where business_id = $1 and session_id is not distinct from $2`,
        [w.business, session],
      )
    ).rows[0]!.n,
  );

describe("jornada", () => {
  it("una jornada abierta o pendiente por cobrador; liquidada permite otra; un inactivo no abre", async () => {
    await withRollback(pool, async (client) => {
      const w = await world(client);
      const first = await openSession(client, w);
      expect(
        (
          await attempt(
            client,
            "insert into public.cash_sessions (business_id, collector_id, business_date) values ($1, $2, current_date)",
            [w.business, w.collector],
          )
        )?.code,
      ).toBe(UNIQUE_VIOLATION);
      await declare(client, w, first, 0);
      // Pendiente también bloquea abrir otra, de cualquier día.
      expect(
        (
          await attempt(
            client,
            "insert into public.cash_sessions (business_id, collector_id, business_date) values ($1, $2, current_date + 1)",
            [w.business, w.collector],
          )
        )?.code,
      ).toBe(UNIQUE_VIOLATION);
      await confirm(client, w, first, 0, 0);
      expect(
        await attempt(
          client,
          "insert into public.cash_sessions (business_id, collector_id, business_date) values ($1, $2, current_date)",
          [w.business, w.collector],
        ),
      ).toBeNull();
    });
  });

  it("un cobrador inactivo no abre jornada y no se desactiva con una abierta", async () => {
    await withRollback(pool, async (client) => {
      const w = await world(client);
      await client.query(
        "update public.client_assignments set status = 'CERRADA', ended_at = now()",
      );
      await client.query(
        "update public.routes set status = 'CERRADA', closed_at = now() where id = $1",
        [w.route],
      );
      const session = await openSession(client, w);
      expect(
        (
          await attempt(client, "update public.collectors set status = 'INACTIVO' where id = $1", [
            w.collector,
          ])
        )?.code,
      ).toBe(CHECK_VIOLATION);
      await declare(client, w, session, 0);
      await confirm(client, w, session, 0, 0);
      expect(
        await attempt(client, "update public.collectors set status = 'INACTIVO' where id = $1", [
          w.collector,
        ]),
      ).toBeNull();
      expect(
        (
          await attempt(
            client,
            "insert into public.cash_sessions (business_id, collector_id, business_date) values ($1, $2, current_date)",
            [w.business, w.collector],
          )
        )?.code,
      ).toBe(CHECK_VIOLATION);
    });
  });

  it("las transiciones solo avanzan y cada una exige su liquidación; las fechas no se reescriben", async () => {
    await withRollback(pool, async (client) => {
      const w = await world(client);
      const session = await openSession(client, w);
      const jump = (status: string) =>
        attempt(
          client,
          "update public.cash_sessions set status = $2, closed_at = now() where id = $1",
          [session, status],
        );
      expect((await jump("LIQUIDADA"))?.code).toBe(RESTRICT_VIOLATION);
      // Declarar sin liquidación no vale.
      expect(
        (
          await attempt(
            client,
            "update public.cash_sessions set status = 'PENDIENTE_LIQUIDACION', declared_at = now() where id = $1",
            [session],
          )
        )?.code,
      ).toBe(CHECK_VIOLATION);
      await declare(client, w, session, 0);
      // Liquidar sin confirmar la liquidación no vale.
      expect((await jump("LIQUIDADA"))?.code).toBe(CHECK_VIOLATION);
      await confirm(client, w, session, 0, 0);
      for (const statement of [
        "update public.cash_sessions set status = 'ABIERTA', declared_at = null, closed_at = null",
        "update public.cash_sessions set closed_at = now() + interval '1 day'",
        "delete from public.cash_sessions",
        "truncate public.cash_sessions",
      ]) {
        const error = await attempt(client, statement);
        expect([RESTRICT_VIOLATION, "0A000", CHECK_VIOLATION], statement).toContain(error?.code);
      }
    });
  });
});

describe("fondo, cobros y gastos", () => {
  it("el fondo es un par espejo: sin su contraparte se rechaza y las dos cajas cuadran", async () => {
    await withRollback(pool, async (client) => {
      const w = await world(client);
      const session = await openSession(client, w);
      await fund(client, w, session, 200);
      expect(await check(client)).toBeNull();
      await client.query("set constraints all deferred");
      expect(await balance(client, session, w)).toBe(200);
      expect(await balance(client, null, w)).toBe(800);

      // Solo del lado de la jornada: no hay espejo en la Mayor.
      await menor(client, w, session, "FONDO_OPERATIVO", "ENTRADA", 50, { by: w.admin });
      expect((await check(client))?.code).toBe(CHECK_VIOLATION);
    });
  });

  it("no hay fondo con la Mayor sin saldo, ni fondo en una jornada que no está abierta", async () => {
    await withRollback(pool, async (client) => {
      const w = await world(client, { funds: 100 });
      const session = await openSession(client, w);
      await fund(client, w, session, 500);
      expect((await check(client))?.code).toBe(CHECK_VIOLATION);
    });
    await withRollback(pool, async (client) => {
      const w = await world(client);
      const session = await openSession(client, w);
      await declare(client, w, session, 0);
      expect(
        (
          await attempt(
            client,
            "insert into public.cash_movements (business_id, cashbox_id, type, direction, amount, reference_type, reference_id, created_by) values ($1, $2, 'FONDO_OPERATIVO', 'SALIDA', 10, 'session', $3, $4)",
            [w.business, w.box, session, w.admin],
          )
        )?.code,
      ).toBe(CHECK_VIOLATION);
    });
  });

  it("el cobro del cobrador suma a su jornada y reduce la deuda; el saldo esperado es fondo + cobros − gastos", async () => {
    await withRollback(pool, async (client) => {
      const w = await world(client);
      const session = await openSession(client, w);
      await fund(client, w, session, 100);
      await collect(client, w, session, 80);
      await menor(client, w, session, "GASTO_COBRADOR", "SALIDA", 30);
      expect(await check(client)).toBeNull();
      await client.query("set constraints all deferred");
      expect(await balance(client, session, w)).toBe(150);
      const applied = await client.query<{ n: string }>(
        "select private.installment_applied($1)::text as n",
        [w.installments[0]],
      );
      expect(applied.rows[0]!.n).toBe("80");
      // La Mayor no recibió el cobro.
      expect(await balance(client, null, w)).toBe(900);
    });
  });

  it("un gasto que dejaría la jornada en negativo se rechaza", async () => {
    await withRollback(pool, async (client) => {
      const w = await world(client);
      const session = await openSession(client, w);
      await fund(client, w, session, 50);
      await menor(client, w, session, "GASTO_COBRADOR", "SALIDA", 60);
      expect((await check(client))?.code).toBe(CHECK_VIOLATION);
    });
  });

  it("solo se registra en una jornada abierta; el gasto del cobrador no existe en la Mayor", async () => {
    await withRollback(pool, async (client) => {
      const w = await world(client);
      const session = await openSession(client, w);
      await fund(client, w, session, 100);
      await declare(client, w, session, 100);
      for (const type of ["COBRO", "GASTO_COBRADOR"] as const) {
        expect(
          (
            await attempt(
              client,
              "insert into public.cash_movements (business_id, cashbox_id, session_id, type, direction, amount, created_by) values ($1, $2, $3, $4, $5, 10, $6)",
              [
                w.business,
                w.box,
                session,
                type,
                type === "COBRO" ? "ENTRADA" : "SALIDA",
                w.collectorUser,
              ],
            )
          )?.code,
          type,
        ).toBe(CHECK_VIOLATION);
      }
      expect(
        (
          await attempt(
            client,
            "insert into public.cash_movements (business_id, cashbox_id, type, direction, amount, created_by) values ($1, $2, 'GASTO_COBRADOR', 'SALIDA', 1, $3)",
            [w.business, w.box, w.admin],
          )
        )?.code,
      ).toBe(CHECK_VIOLATION);
    });
  });

  it("el cobrador solo cobra a clientes asignados a él y el Admin no cobra dentro de una jornada ajena", async () => {
    await withRollback(pool, async (client) => {
      const w = await world(client);
      const session = await openSession(client, w);
      await fund(client, w, session, 100);

      // Otro cobrador del mismo negocio, con su jornada.
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
      const otherSession = (
        await client.query<{ id: string }>(
          "insert into public.cash_sessions (business_id, collector_id, business_date) values ($1, $2, current_date) returning id",
          [w.business, other],
        )
      ).rows[0]!.id;
      const movementId = await menor(client, w, otherSession, "COBRO", "ENTRADA", 10, {
        by: otherUser,
      });
      const error = await attempt(
        client,
        "insert into public.payments (business_id, loan_id, kind, amount, movement_id, registered_by) values ($1, $2, 'CUOTAS', 10, $3, $4)",
        [w.business, w.loanId, movementId, otherUser],
      );
      expect(error?.code).toBe(CHECK_VIOLATION);

      // El Admin no registra el cobro dentro de la jornada de un cobrador.
      const adminMovement = await menor(client, w, session, "COBRO", "ENTRADA", 10, {
        by: w.admin,
      });
      expect(
        (
          await attempt(
            client,
            "insert into public.payments (business_id, loan_id, kind, amount, movement_id, registered_by) values ($1, $2, 'CUOTAS', 10, $3, $4)",
            [w.business, w.loanId, adminMovement, w.admin],
          )
        )?.code,
      ).toBe(CHECK_VIOLATION);
    });
  });

  it("reasignado el cliente, el cobrador anterior ya no cobra", async () => {
    await withRollback(pool, async (client) => {
      const w = await world(client);
      const session = await openSession(client, w);
      await client.query(
        "update public.client_assignments set status = 'CERRADA', ended_at = now()",
      );
      const movementId = await menor(client, w, session, "COBRO", "ENTRADA", 10);
      expect(
        (
          await attempt(
            client,
            "insert into public.payments (business_id, loan_id, kind, amount, movement_id, registered_by) values ($1, $2, 'CUOTAS', 10, $3, $4)",
            [w.business, w.loanId, movementId, w.collectorUser],
          )
        )?.code,
      ).toBe(CHECK_VIOLATION);
    });
  });

  it("el reverso de un cobro de jornada va en la misma jornada, mientras esté abierta o pendiente", async () => {
    await withRollback(pool, async (client) => {
      const w = await world(client);
      const session = await openSession(client, w);
      await fund(client, w, session, 100);
      const paid = await collect(client, w, session, 40);
      // Un reverso en la Mayor del cobro de una jornada no cuadra.
      expect(
        (
          await attempt(
            client,
            "insert into public.cash_movements (business_id, cashbox_id, type, direction, amount, reason, reverses_movement_id, created_by) values ($1, $2, 'REVERSO', 'SALIDA', 40, 'x', $3, $4)",
            [w.business, w.box, paid.movementId, w.admin],
          )
        )?.code,
      ).toBe(CHECK_VIOLATION);

      await declare(client, w, session, 100);
      const reversal = await menor(client, w, session, "REVERSO", "SALIDA", 40, {
        by: w.admin,
        reverses: paid.movementId,
        reason: "Error",
      });
      await client.query(
        "insert into public.payment_reversals (business_id, payment_id, reason, movement_id, reversed_by) values ($1, $2, 'Error', $3, $4)",
        [w.business, paid.paymentId, reversal, w.admin],
      );
      await client.query("set constraints all deferred");
      expect(await balance(client, session, w)).toBe(100);
    });
  });
});

describe("liquidación", () => {
  it("cuadrada: lo entregado vuelve a la Mayor y la jornada queda en cero", async () => {
    await withRollback(pool, async (client) => {
      const w = await world(client);
      const session = await openSession(client, w);
      await fund(client, w, session, 100);
      await collect(client, w, session, 80);
      await declare(client, w, session, 180);
      await confirm(client, w, session, 180, 180);
      expect(await check(client)).toBeNull();
      await client.query("set constraints all deferred");
      expect(await balance(client, session, w)).toBe(0);
      expect(await balance(client, null, w)).toBe(1080);
      const state = await client.query("select status from public.cash_sessions where id = $1", [
        session,
      ]);
      expect(state.rows[0]!.status).toBe("LIQUIDADA");
    });
  });

  it("con faltante o sobrante se registra la diferencia, exige observación y la jornada queda en cero", async () => {
    for (const [expected, received, sign] of [
      [180, 150, 30],
      [180, 200, -20],
    ] as const) {
      await withRollback(pool, async (client) => {
        const w = await world(client);
        const session = await openSession(client, w);
        await fund(client, w, session, 100);
        await collect(client, w, session, 80);
        await declare(client, w, session, received);
        await confirm(client, w, session, expected, received, "Se perdió");
        expect(await check(client)).toBeNull();
        await client.query("set constraints all deferred");
        expect(await balance(client, session, w)).toBe(0);
        expect(await balance(client, null, w)).toBe(900 + received);
        const row = await client.query(
          "select status, difference::int from public.settlements where session_id = $1",
          [session],
        );
        expect(row.rows[0]).toEqual({ status: "CON_DIFERENCIA", difference: sign });
        const closed = await client.query("select status from public.cash_sessions where id = $1", [
          session,
        ]);
        expect(closed.rows[0]!.status).toBe("LIQUIDADA_CON_DIFERENCIA");
      });
    }
    // Sin observación no se acepta una diferencia.
    await withRollback(pool, async (client) => {
      const w = await world(client);
      const session = await openSession(client, w);
      await fund(client, w, session, 100);
      await declare(client, w, session, 90);
      const error = await attempt(
        client,
        "update public.settlements set status = 'CON_DIFERENCIA', expected_amount = 100, received_amount = 90, difference = 10, confirmed_by = $2, confirmed_at = now() where session_id = $1",
        [session, w.admin],
      );
      expect(error?.code).toBe(CHECK_VIOLATION);
    });
  });

  it("una liquidación que no cuadra con los movimientos se rechaza", async () => {
    await withRollback(pool, async (client) => {
      const w = await world(client);
      const session = await openSession(client, w);
      await fund(client, w, session, 100);
      await declare(client, w, session, 100);
      // Dice recibir 100 pero la jornada no tiene movimientos de liquidación: la jornada no queda en cero.
      await client.query(
        "update public.settlements set status = 'CUADRADA', expected_amount = 100, received_amount = 100, difference = 0, confirmed_by = $2, confirmed_at = now() where session_id = $1",
        [session, w.admin],
      );
      expect(
        (
          await attempt(
            client,
            "update public.cash_sessions set status = 'LIQUIDADA', closed_at = now() where id = $1",
            [session],
          )
        )?.code,
      ).toBe(CHECK_VIOLATION);
    });
  });

  it("la liquidación confirmada no se modifica, no se declara dos veces ni la confirma un cobrador", async () => {
    await withRollback(pool, async (client) => {
      const w = await world(client);
      const session = await openSession(client, w);
      expect(
        (
          await attempt(
            client,
            "insert into public.settlements (business_id, session_id, collector_id, declared_amount, declared_by) values ($1, $2, $3, 0, $4)",
            [w.business, session, w.collector, w.admin],
          )
        )?.code,
      ).toBe(CHECK_VIOLATION);
      await declare(client, w, session, 0);
      expect(
        (
          await attempt(
            client,
            "insert into public.settlements (business_id, session_id, collector_id, declared_amount, declared_by) values ($1, $2, $3, 0, $4)",
            [w.business, session, w.collector, w.collectorUser],
          )
        )?.code,
      ).toBe(CHECK_VIOLATION);
      expect(
        (
          await attempt(
            client,
            "update public.settlements set status = 'CUADRADA', expected_amount = 0, received_amount = 0, difference = 0, confirmed_by = $2, confirmed_at = now() where session_id = $1",
            [session, w.collectorUser],
          )
        )?.code,
      ).toBe(CHECK_VIOLATION);
      await confirm(client, w, session, 0, 0);
      for (const statement of [
        "update public.settlements set declared_amount = 5",
        "update public.settlements set difference = 1",
        "delete from public.settlements",
      ]) {
        expect([RESTRICT_VIOLATION, CHECK_VIOLATION], statement).toContain(
          (await attempt(client, statement))?.code,
        );
      }
    });
  });

  it("la diferencia se resuelve con un AJUSTE de la Mayor, una sola vez y solo si hubo diferencia", async () => {
    await withRollback(pool, async (client) => {
      const w = await world(client);
      const session = await openSession(client, w);
      await fund(client, w, session, 100);
      await declare(client, w, session, 90);
      await confirm(client, w, session, 100, 90, "Faltaron 10");
      const adjustment = await mayor(client, w, "AJUSTE", "ENTRADA", 10, {
        reason: "El cobrador repuso el faltante",
      });
      const settlement = (
        await client.query<{ id: string }>(
          "select id from public.settlements where session_id = $1",
          [session],
        )
      ).rows[0]!.id;
      const resolve = (movement: string) =>
        attempt(
          client,
          "insert into public.settlement_resolutions (business_id, settlement_id, movement_id, note, resolved_by) values ($1, $2, $3, 'Repuesto', $4)",
          [w.business, settlement, movement, w.admin],
        );
      expect(await resolve(adjustment)).toBeNull();
      const second = await mayor(client, w, "AJUSTE", "ENTRADA", 1, { reason: "otro" });
      expect((await resolve(second))?.code).toBe(UNIQUE_VIOLATION);
    });
    await withRollback(pool, async (client) => {
      const w = await world(client);
      const session = await openSession(client, w);
      await declare(client, w, session, 0);
      await confirm(client, w, session, 0, 0);
      const settlement = (
        await client.query<{ id: string }>(
          "select id from public.settlements where session_id = $1",
          [session],
        )
      ).rows[0]!.id;
      const adjustment = await mayor(client, w, "AJUSTE", "ENTRADA", 10, { reason: "x" });
      expect(
        (
          await attempt(
            client,
            "insert into public.settlement_resolutions (business_id, settlement_id, movement_id, note, resolved_by) values ($1, $2, $3, 'x', $4)",
            [w.business, settlement, adjustment, w.admin],
          )
        )?.code,
      ).toBe(CHECK_VIOLATION);
    });
  });
});

describe("aislamiento y acceso", () => {
  it("la jornada y sus movimientos son de un solo negocio y la API de datos solo deja leer lo propio", async () => {
    await withRollback(pool, async (client) => {
      const a = await world(client);
      const b = await world(client);
      const sessionA = await openSession(client, a);
      const sessionB = await openSession(client, b);
      await fund(client, a, sessionA, 100);
      await fund(client, b, sessionB, 100);

      // Una jornada de otro negocio no se referencia (FK compuesta).
      expect(
        (
          await attempt(
            client,
            "insert into public.cash_movements (business_id, cashbox_id, session_id, type, direction, amount, created_by) values ($1, $2, $3, 'GASTO_COBRADOR', 'SALIDA', 1, $4)",
            [a.business, a.box, sessionB, a.collectorUser],
          )
        )?.code,
      ).toBe(CHECK_VIOLATION);

      const count = async (table: string) =>
        (await client.query<{ n: string }>(`select count(*)::text as n from public.${table}`))
          .rows[0]!.n;
      await asApiUser(client, {
        sub: a.collectorUser,
        app_role: "COBRADOR",
        business_id: a.business,
      });
      expect(await count("cash_sessions")).toBe("1");
      // Solo los movimientos de su jornada (no los de la Mayor).
      expect(await count("cash_movements")).toBe("1");
      for (const statement of [
        "update public.cash_sessions set status = 'ABIERTA'",
        "delete from public.cash_movements",
      ]) {
        expect((await attempt(client, statement))?.code, statement).toBe("42501");
      }
      await resetApiUser(client);

      await asApiUser(client, { sub: b.admin, app_role: "ADMIN_NEGOCIO", business_id: b.business });
      expect(await count("cash_sessions")).toBe("1");
      await resetApiUser(client);
    });
  });
});
