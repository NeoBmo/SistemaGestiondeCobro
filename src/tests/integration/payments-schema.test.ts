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

// F4-T2 (02 §3, ADR 0008): pagos, aplicaciones, reversos, cargos de mora y refinanciación. Todo es de
// solo agregado y el saldo de cuotas y cargos se deriva de las aplicaciones de pagos no reversados.

const pool = createTestPool();
afterAll(() => pool.end());

const CHECK_VIOLATION = "23514";
const RESTRICT_VIOLATION = "23001";
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

type World = Awaited<ReturnType<typeof world>>;

/** Negocio con caja, un Admin, un cliente y un préstamo ACTIVO de tres cuotas de 100 (total 300). */
async function world(client: pg.PoolClient, name = "A") {
  const business = await createBusiness(client, `Negocio ${name}`);
  await createSubscription(client, business);
  const box = await createMainCashbox(client, business);
  const admin = await createProfile(client, {
    role: "ADMIN_NEGOCIO",
    businessId: business,
    username: `admin.${name.toLowerCase()}`,
  });
  const clientId = (
    await client.query<{ id: string }>(
      "insert into public.clients (business_id, name, identification, created_by) values ($1, 'Ana', '1', $2) returning id",
      [business, admin],
    )
  ).rows[0]!.id;
  const loan = await newLoan(client, { business, admin, clientId }, "CT-000001");
  return { business, box, admin, clientId, ...loan };
}

async function newLoan(
  client: pg.PoolClient,
  w: { business: string; admin: string; clientId: string },
  number: string,
  options: { principal?: number; previousLoan?: string } = {},
) {
  const principal = options.principal ?? 300;
  const contract = (
    await client.query<{ id: string }>(
      "insert into public.contracts (business_id, client_id, number, origin, created_by) values ($1, $2, $3, 'NUEVO', $4) returning id",
      [w.business, w.clientId, number, w.admin],
    )
  ).rows[0]!.id;
  const loanId = (
    await client.query<{ id: string }>(
      `insert into public.loans
         (business_id, contract_id, principal_amount, interest_bps, interest_amount, total_amount,
          scheduled_amount, disbursed_on, first_due_on, frequency, installment_count, previous_loan_id, created_by)
       values ($1, $2, $3, 0, 0, $3, $3, '2026-10-13', '2026-10-14', 'DIARIA', 3, $4, $5) returning id`,
      [w.business, contract, principal, options.previousLoan ?? null, w.admin],
    )
  ).rows[0]!.id;
  const per = Math.floor(principal / 3);
  const installments: string[] = [];
  for (const n of [1, 2, 3]) {
    const amount = n === 3 ? principal - per * 2 : per;
    installments.push(
      (
        await client.query<{ id: string }>(
          "insert into public.installments (business_id, loan_id, number, due_on, amount) values ($1, $2, $3, date '2026-10-14' + ($3::int - 1), $4) returning id",
          [w.business, loanId, n, amount],
        )
      ).rows[0]!.id,
    );
  }
  return { loanId, contractId: contract, installments };
}

/** Entrada de caja (COBRO) para el pago, o un movimiento de otro tipo para probar el rechazo. */
async function movement(
  client: pg.PoolClient,
  w: World,
  amount: number,
  type = "COBRO",
  direction = "ENTRADA",
): Promise<string> {
  return (
    await client.query<{ id: string }>(
      `insert into public.cash_movements (business_id, cashbox_id, type, direction, amount, created_by)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [w.business, w.box, type, direction, amount, w.admin],
    )
  ).rows[0]!.id;
}

async function payment(
  client: pg.PoolClient,
  w: World,
  amount: number,
  options: { loanId?: string; kind?: string; chargeId?: string } = {},
): Promise<{ id: string; movementId: string }> {
  const movementId = await movement(client, w, amount);
  const { rows } = await client.query<{ id: string }>(
    `insert into public.payments (business_id, loan_id, kind, late_fee_charge_id, amount, movement_id, registered_by)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [
      w.business,
      options.loanId ?? w.loanId,
      options.kind ?? "CUOTAS",
      options.chargeId ?? null,
      amount,
      movementId,
      w.admin,
    ],
  );
  return { id: rows[0]!.id, movementId };
}

async function apply(
  client: pg.PoolClient,
  w: World,
  paymentId: string,
  position: number,
  amount: number,
  target: { installment?: string; charge?: string },
) {
  await client.query(
    `insert into public.payment_applications (business_id, payment_id, installment_id, late_fee_charge_id, amount, position)
     values ($1, $2, $3, $4, $5, $6)`,
    [w.business, paymentId, target.installment ?? null, target.charge ?? null, amount, position],
  );
}

async function reverse(
  client: pg.PoolClient,
  w: World,
  paid: { id: string; movementId: string },
  amount: number,
) {
  // El movimiento y el reverso van en un savepoint: si el reverso se rechaza, tampoco queda el movimiento.
  await client.query("savepoint reversal");
  const reversalMovement = (
    await client.query<{ id: string }>(
      `insert into public.cash_movements (business_id, cashbox_id, type, direction, amount, reason, reverses_movement_id, created_by)
       values ($1, $2, 'REVERSO', 'SALIDA', $3, 'Error', $4, $5) returning id`,
      [w.business, w.box, amount, paid.movementId, w.admin],
    )
  ).rows[0]!.id;
  const error = await attempt(
    client,
    `insert into public.payment_reversals (business_id, payment_id, reason, movement_id, reversed_by)
     values ($1, $2, 'Error', $3, $4)`,
    [w.business, paid.id, reversalMovement, w.admin],
  );
  if (error) await client.query("rollback to savepoint reversal");
  else await client.query("release savepoint reversal");
  return error;
}

const check = (client: pg.PoolClient) => attempt(client, "set constraints all immediate");

const applied = async (client: pg.PoolClient, installment: string) =>
  (
    await client.query<{ n: string }>("select private.installment_applied($1)::text as n", [
      installment,
    ])
  ).rows[0]!.n;

describe("pagos y aplicaciones", () => {
  it("un pago de cuotas se aplica en orden y suma exactamente su importe", async () => {
    await withRollback(pool, async (client) => {
      const w = await world(client);
      const paid = await payment(client, w, 150);
      await apply(client, w, paid.id, 1, 100, { installment: w.installments[0]! });
      await apply(client, w, paid.id, 2, 50, { installment: w.installments[1]! });

      expect(await check(client)).toBeNull();
      expect(await applied(client, w.installments[0]!)).toBe("100");
      expect(await applied(client, w.installments[1]!)).toBe("50");
    });
  });

  it("rechaza un pago que no se aplica por completo, o que aplica más de lo que suma", async () => {
    const run = (amounts: number[]) =>
      withRollback(pool, async (client) => {
        const w = await world(client);
        const paid = await payment(client, w, 150);
        for (const [i, amount] of amounts.entries()) {
          await apply(client, w, paid.id, i + 1, amount, { installment: w.installments[i]! });
        }
        return check(client);
      });

    expect(await run([100, 50])).toBeNull();
    expect((await run([100, 49]))?.constraint).toBe("payment_fully_applied");
    expect((await run([100]))?.constraint).toBe("payment_fully_applied");
    expect((await run([]))?.constraint).toBe("payment_fully_applied");
  });

  it("ninguna cuota recibe más que su saldo, ni entre varios pagos", async () => {
    await withRollback(pool, async (client) => {
      const w = await world(client);
      const first = await payment(client, w, 80);
      await apply(client, w, first.id, 1, 80, { installment: w.installments[0]! });
      expect(await check(client)).toBeNull();
      await client.query("set constraints all deferred");

      const second = await payment(client, w, 40);
      await apply(client, w, second.id, 1, 40, { installment: w.installments[0]! });
      // 80 + 40 = 120 > 100 (valor esperado de la cuota 1).
      expect((await check(client))?.constraint).toBe("payment_within_balance");
    });
  });

  it("el tipo del pago decide a qué se aplica; el movimiento debe ser un COBRO de entrada por el mismo importe", async () => {
    await withRollback(pool, async (client) => {
      const w = await world(client);
      const charge = (
        await client.query<{ id: string }>(
          "insert into public.late_fee_charges (business_id, loan_id, amount, reason, created_by) values ($1, $2, 50, 'Atraso', $3) returning id",
          [w.business, w.loanId, w.admin],
        )
      ).rows[0]!.id;

      // Un pago de cuotas no se aplica a un cargo, y uno de cargo no se aplica a cuotas.
      const cuotas = await payment(client, w, 50);
      expect(
        (
          await attempt(
            client,
            `insert into public.payment_applications (business_id, payment_id, late_fee_charge_id, amount, position) values ($1, $2, $3, 50, 1)`,
            [w.business, cuotas.id, charge],
          )
        )?.code,
      ).toBe(CHECK_VIOLATION);
      const mora = await payment(client, w, 50, { kind: "CARGO_MORA", chargeId: charge });
      expect(
        (
          await attempt(
            client,
            `insert into public.payment_applications (business_id, payment_id, installment_id, amount, position) values ($1, $2, $3, 50, 1)`,
            [w.business, mora.id, w.installments[0]!],
          )
        )?.code,
      ).toBe(CHECK_VIOLATION);

      // Un cargo exige su pago de cargo y viceversa; el movimiento debe ser un COBRO coherente.
      const insert = (kind: string, charge: string | null, movementId: string, amount = 10) =>
        attempt(
          client,
          `insert into public.payments (business_id, loan_id, kind, late_fee_charge_id, amount, movement_id, registered_by) values ($1, $2, $3, $4, $5, $6, $7)`,
          [w.business, w.loanId, kind, charge, amount, movementId, w.admin],
        );
      expect((await insert("CARGO_MORA", null, await movement(client, w, 10)))?.code).toBe(
        CHECK_VIOLATION,
      );
      expect((await insert("CUOTAS", charge, await movement(client, w, 10)))?.code).toBe(
        CHECK_VIOLATION,
      );
      expect(
        (await insert("CUOTAS", null, await movement(client, w, 10, "INGRESO_CAPITAL")))?.code,
      ).toBe(CHECK_VIOLATION);
      expect((await insert("CUOTAS", null, await movement(client, w, 9)))?.code).toBe(
        CHECK_VIOLATION,
      );
    });
  });

  it("solo se pagan préstamos ACTIVOS, y los hechos son de solo agregado", async () => {
    await withRollback(pool, async (client) => {
      const w = await world(client);
      const paid = await payment(client, w, 100);
      await apply(client, w, paid.id, 1, 100, { installment: w.installments[0]! });
      await client.query("set constraints all deferred");

      for (const statement of [
        "update public.payments set amount = 1",
        "delete from public.payments",
        "update public.payment_applications set amount = 1",
        "delete from public.payment_applications",
      ]) {
        expect((await attempt(client, statement))?.code, statement).toBe(RESTRICT_VIOLATION);
      }

      const other = await newLoan(client, w, "CT-000002");
      await client.query("update public.loans set status = 'ANULADO' where id = $1", [
        other.loanId,
      ]);
      await client.query(
        "update public.contracts set status = 'ANULADO', voided_at = now(), voided_by = $2, void_reason = 'x' where id = $1",
        [other.contractId, w.admin],
      );
      const movementId = await movement(client, w, 10);
      expect(
        (
          await attempt(
            client,
            `insert into public.payments (business_id, loan_id, kind, amount, movement_id, registered_by) values ($1, $2, 'CUOTAS', 10, $3, $4)`,
            [w.business, other.loanId, movementId, w.admin],
          )
        )?.code,
      ).toBe(CHECK_VIOLATION);
    });
  });
});

describe("reverso de pagos", () => {
  it("solo se reversa el pago más reciente; reversado, sus cuotas recuperan el saldo y pueden pagarse de nuevo", async () => {
    await withRollback(pool, async (client) => {
      const w = await world(client);
      const first = await payment(client, w, 100);
      await apply(client, w, first.id, 1, 100, { installment: w.installments[0]! });
      const second = await payment(client, w, 60);
      await apply(client, w, second.id, 1, 60, { installment: w.installments[1]! });
      await client.query("set constraints all deferred");

      // El primero no se puede reversar mientras exista uno posterior vigente.
      expect((await reverse(client, w, first, 100))?.constraint).toBe(
        "payment_reversal_latest_only",
      );
      expect(await reverse(client, w, second, 60)).toBeNull();
      expect(await applied(client, w.installments[1]!)).toBe("0");
      // Ahora sí el primero, y solo una vez cada uno.
      expect(await reverse(client, w, first, 100)).toBeNull();
      expect(await applied(client, w.installments[0]!)).toBe("0");
      const duplicate = await attempt(
        client,
        "insert into public.payment_reversals (business_id, payment_id, reason, movement_id, reversed_by) select business_id, payment_id, 'otra vez', movement_id, reversed_by from public.payment_reversals where payment_id = $1",
        [first.id],
      );
      expect(duplicate?.code, "un pago se reversa una sola vez").toBe(UNIQUE_VIOLATION);

      // La aplicación original permanece (el pago no se borra) y la cuota admite un pago nuevo completo.
      const kept = await client.query(
        "select 1 from public.payment_applications where payment_id = $1",
        [first.id],
      );
      expect(kept.rowCount).toBe(1);
      const again = await payment(client, w, 100);
      await apply(client, w, again.id, 1, 100, { installment: w.installments[0]! });
      expect(await check(client)).toBeNull();
    });
  });

  it("el movimiento del reverso debe ser el REVERSO del COBRO del pago", async () => {
    await withRollback(pool, async (client) => {
      const w = await world(client);
      const paid = await payment(client, w, 100);
      await apply(client, w, paid.id, 1, 100, { installment: w.installments[0]! });
      const unrelated = await movement(client, w, 100, "INGRESO_CAPITAL");

      const error = await attempt(
        client,
        "insert into public.payment_reversals (business_id, payment_id, reason, movement_id, reversed_by) values ($1, $2, 'x', $3, $4)",
        [w.business, paid.id, unrelated, w.admin],
      );

      expect(error?.code).toBe(CHECK_VIOLATION);
    });
  });
});

describe("cargos de mora", () => {
  it("se crean sobre un préstamo activo con una cuota del mismo préstamo y se anulan solo sin pagos vigentes", async () => {
    await withRollback(pool, async (client) => {
      const w = await world(client);
      const other = await newLoan(client, w, "CT-000002");
      const insertCharge = (installment: string | null) =>
        attempt(
          client,
          "insert into public.late_fee_charges (business_id, loan_id, installment_id, amount, reason, created_by) values ($1, $2, $3, 50, 'Atraso', $4)",
          [w.business, w.loanId, installment, w.admin],
        );
      expect(await insertCharge(w.installments[0]!)).toBeNull();
      expect((await insertCharge(other.installments[0]!))?.code, "cuota de otro préstamo").toBe(
        CHECK_VIOLATION,
      );
      expect(
        (
          await attempt(
            client,
            "insert into public.late_fee_charges (business_id, loan_id, amount, reason, created_by) values ($1, $2, 0, 'x', $3)",
            [w.business, w.loanId, w.admin],
          )
        )?.code,
      ).toBe(CHECK_VIOLATION);
      expect(
        (
          await attempt(
            client,
            "insert into public.late_fee_charges (business_id, loan_id, amount, reason, created_by) values ($1, $2, 5, '  ', $3)",
            [w.business, w.loanId, w.admin],
          )
        )?.code,
      ).toBe(CHECK_VIOLATION);

      const charge = (
        await client.query<{ id: string }>(
          "select id from public.late_fee_charges where business_id = $1",
          [w.business],
        )
      ).rows[0]!.id;
      const paid = await payment(client, w, 50, { kind: "CARGO_MORA", chargeId: charge });
      await apply(client, w, paid.id, 1, 50, { charge });
      await client.query("set constraints all deferred");

      const voidIt = () =>
        attempt(
          client,
          "insert into public.late_fee_voids (business_id, charge_id, reason, voided_by) values ($1, $2, 'Error', $3)",
          [w.business, charge, w.admin],
        );
      expect((await voidIt())?.constraint, "con pago vigente").toBe(
        "late_fee_void_without_payments",
      );
      expect(await reverse(client, w, paid, 50)).toBeNull();
      expect(await voidIt()).toBeNull();
      expect((await voidIt())?.code, "una sola anulación").toBe(UNIQUE_VIOLATION);
      // Un cargo anulado ya no se paga.
      const movementId = await movement(client, w, 10);
      expect(
        (
          await attempt(
            client,
            "insert into public.payments (business_id, loan_id, kind, late_fee_charge_id, amount, movement_id, registered_by) values ($1, $2, 'CARGO_MORA', $3, 10, $4, $5)",
            [w.business, w.loanId, charge, movementId, w.admin],
          )
        )?.code,
      ).toBe(CHECK_VIOLATION);
    });
  });
});

describe("anular un préstamo con pagos", () => {
  it("se rechaza con pagos vigentes y se permite una vez reversados", async () => {
    await withRollback(pool, async (client) => {
      const w = await world(client);
      const paid = await payment(client, w, 100);
      await apply(client, w, paid.id, 1, 100, { installment: w.installments[0]! });
      await client.query("set constraints all deferred");

      expect(
        (
          await attempt(client, "update public.loans set status = 'ANULADO' where id = $1", [
            w.loanId,
          ])
        )?.constraint,
      ).toBe("loan_annul_without_payments");
      expect(await reverse(client, w, paid, 100)).toBeNull();
      expect(
        await attempt(client, "update public.loans set status = 'ANULADO' where id = $1", [
          w.loanId,
        ]),
      ).toBeNull();
    });
  });
});

describe("refinanciación", () => {
  async function refinance(
    client: pg.PoolClient,
    w: World,
    options: {
      balance: number;
      additional?: number;
      markPrevious?: boolean;
      principal?: number;
      link?: boolean;
      disburse?: boolean;
    },
  ) {
    const additional = options.additional ?? 0;
    const next = await newLoan(client, w, "CT-000009", {
      principal: options.principal ?? options.balance + additional,
      previousLoan: options.link === false ? undefined : w.loanId,
    });
    if (additional > 0 && options.disburse !== false) {
      await client.query(
        `insert into public.cash_movements (business_id, cashbox_id, type, direction, amount, reference_type, reference_id, created_by)
         values ($1, $2, 'DESEMBOLSO_PRESTAMO', 'SALIDA', $3, 'loan', $4, $5)`,
        [w.business, w.box, additional, next.loanId, w.admin],
      );
    }
    const error = await attempt(
      client,
      `insert into public.refinancings (business_id, previous_loan_id, new_loan_id, refinanced_balance, additional_amount, created_by)
       values ($1, $2, $3, $4, $5, $6)`,
      [w.business, w.loanId, next.loanId, options.balance, additional, w.admin],
    );
    if (options.markPrevious !== false) {
      await client.query("update public.loans set status = 'REFINANCIADO' where id = $1", [
        w.loanId,
      ]);
    }
    return { error, next };
  }

  it("el saldo refinanciado es el pendiente de las cuotas y el nuevo principal es saldo + adicional", async () => {
    await withRollback(pool, async (client) => {
      const w = await world(client);
      const paid = await payment(client, w, 100);
      await apply(client, w, paid.id, 1, 100, { installment: w.installments[0]! });
      await client.query("set constraints all deferred");

      // Pendiente real: 200 (la cuota 1 ya está pagada).
      expect(
        (await refinance(client, w, { balance: 300, markPrevious: false })).error?.constraint,
      ).toBe("refinancing_balance_matches");
    });
    await withRollback(pool, async (client) => {
      const w = await world(client);
      const paid = await payment(client, w, 100);
      await apply(client, w, paid.id, 1, 100, { installment: w.installments[0]! });
      await client.query("set constraints all deferred");

      const ok = await refinance(client, w, { balance: 200, additional: 50 });
      expect(ok.error).toBeNull();
      expect(await check(client)).toBeNull();
    });
    await withRollback(pool, async (client) => {
      const w = await world(client);
      expect(
        (
          await refinance(client, w, {
            balance: 300,
            additional: 50,
            principal: 300,
            markPrevious: false,
          })
        ).error?.constraint,
      ).toBe("refinancing_new_loan_matches");
      const w2 = await world(client, "B");
      expect(
        (await refinance(client, w2, { balance: 300, link: false, markPrevious: false })).error
          ?.constraint,
      ).toBe("refinancing_new_loan_matches");
    });
  });

  it("se rechaza con cargos de mora activos, y el préstamo anterior debe quedar REFINANCIADO", async () => {
    await withRollback(pool, async (client) => {
      const w = await world(client);
      await client.query(
        "insert into public.late_fee_charges (business_id, loan_id, amount, reason, created_by) values ($1, $2, 50, 'Atraso', $3)",
        [w.business, w.loanId, w.admin],
      );
      expect(
        (await refinance(client, w, { balance: 300, markPrevious: false })).error?.constraint,
      ).toBe("refinancing_without_active_fees");
    });
    await withRollback(pool, async (client) => {
      const w = await world(client);
      const { error } = await refinance(client, w, { balance: 300, markPrevious: false });
      expect(error).toBeNull();
      expect((await check(client))?.constraint).toBe("refinanced_loan_status");
    });
    await withRollback(pool, async (client) => {
      const w = await world(client);
      const first = await refinance(client, w, { balance: 300 });
      expect(first.error).toBeNull();
      expect(await check(client)).toBeNull();
      await client.query("set constraints all deferred");
      // Un préstamo refinanciado ya no se refinancia ni se paga.
      const next = await newLoan(client, w, "CT-000010", { principal: 300 });
      expect(
        (
          await attempt(
            client,
            "insert into public.refinancings (business_id, previous_loan_id, new_loan_id, refinanced_balance, additional_amount, created_by) values ($1, $2, $3, 300, 0, $4)",
            [w.business, w.loanId, next.loanId, w.admin],
          )
        )?.code,
      ).toBe(CHECK_VIOLATION);
    });
  });

  it("el estado REFINANCIADO es un destino válido solo desde ACTIVO", async () => {
    await withRollback(pool, async (client) => {
      const w = await world(client);
      await client.query("set constraints all deferred");
      expect(
        await attempt(client, "update public.loans set status = 'REFINANCIADO' where id = $1", [
          w.loanId,
        ]),
      ).toBeNull();
      expect(
        (
          await attempt(client, "update public.loans set status = 'ACTIVO' where id = $1", [
            w.loanId,
          ])
        )?.code,
      ).toBe(RESTRICT_VIOLATION);
      expect(
        (
          await attempt(client, "update public.loans set status = 'ANULADO' where id = $1", [
            w.loanId,
          ])
        )?.code,
      ).toBe(RESTRICT_VIOLATION);
    });
  });
});

describe("RLS de pagos", () => {
  it("el Admin ve solo lo de su negocio; cobrador y Super Admin no; nadie escribe por la API", async () => {
    await withRollback(pool, async (client) => {
      const a = await world(client, "A");
      const b = await world(client, "B");
      for (const w of [a, b]) {
        const paid = await payment(client, w, 100);
        await apply(client, w, paid.id, 1, 100, { installment: w.installments[0]! });
      }
      const collector = await createProfile(client, {
        role: "COBRADOR",
        businessId: a.business,
        username: "cobrador.a",
      });
      const superAdmin = await createProfile(client, {
        role: "SUPER_ADMIN",
        businessId: null,
        username: "root.admin",
      });
      const count = async (table: string) =>
        (await client.query<{ n: string }>(`select count(*) as n from public.${table}`)).rows[0]!.n;
      const tables = [
        "payments",
        "payment_applications",
        "late_fee_charges",
        "refinancings",
        "payment_reversals",
        "late_fee_voids",
      ];

      await asApiUser(client, { sub: a.admin, app_role: "ADMIN_NEGOCIO", business_id: a.business });
      expect(await count("payments")).toBe("1");
      expect(await count("payment_applications")).toBe("1");
      for (const statement of [
        "insert into public.payments (business_id, loan_id, kind, amount, movement_id, registered_by) values (gen_random_uuid(), gen_random_uuid(), 'CUOTAS', 1, gen_random_uuid(), gen_random_uuid())",
        "update public.payments set amount = 1",
        "delete from public.payment_applications",
      ]) {
        expect((await attempt(client, statement))?.code, statement).toBe("42501");
      }
      await resetApiUser(client);

      for (const [who, claims] of [
        ["cobrador", { sub: collector, app_role: "COBRADOR" as const, business_id: a.business }],
        ["super admin", { sub: superAdmin, app_role: "SUPER_ADMIN" as const, business_id: null }],
      ] as const) {
        await asApiUser(client, claims);
        for (const table of tables) expect(await count(table), `${who} ${table}`).toBe("0");
        await resetApiUser(client);
      }
    });
  });

  it("una cuota o cargo de otro negocio no se puede referenciar", async () => {
    await withRollback(pool, async (client) => {
      const a = await world(client, "A");
      const b = await world(client, "B");
      const paid = await payment(client, a, 10);
      const error = await attempt(
        client,
        "insert into public.payment_applications (business_id, payment_id, installment_id, amount, position) values ($1, $2, $3, 10, 1)",
        [a.business, paid.id, b.installments[0]!],
      );
      // El trigger de coherencia (cuota de otro préstamo) o la clave foránea compuesta: ambos lo impiden.
      expect([CHECK_VIOLATION, FOREIGN_KEY_VIOLATION]).toContain(error?.code);
    });
  });
});
