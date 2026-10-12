import type pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { TestFixtures, createAdminClient } from "./helpers/auth";
import { attempt, createTestPool, sleep, withRollback } from "./helpers/db";

// Barreras de la base de datos de F4 (ADR 0008): aplicación cronológica, consistencia con la caja,
// refinanciación íntegra y, con dos conexiones reales, las carreras entre pagos, reversos y refinanciación.

const pool = createTestPool();
const fixtures = new TestFixtures(pool, createAdminClient());

afterAll(async () => {
  await fixtures.purge();
  await pool.end();
});

const CHECK_VIOLATION = "23514";

type World = {
  business: string;
  box: string;
  admin: string;
  clientId: string;
  loanId: string;
  installments: string[];
};

/** Negocio real (con caja y Admin) y un préstamo ACTIVO de tres cuotas de 100, confirmado en la base. */
async function world(): Promise<World> {
  const business = await fixtures.business("Pagos carreras");
  const admin = (await fixtures.account({ role: "ADMIN_NEGOCIO", businessId: business })).userId;
  const box = (
    await pool.query<{ id: string }>(
      "select id from public.main_cashboxes where business_id = $1",
      [business],
    )
  ).rows[0]!.id;
  const clientId = (
    await pool.query<{ id: string }>(
      "insert into public.clients (business_id, name, identification, created_by) values ($1, 'Ana', '1', $2) returning id",
      [business, admin],
    )
  ).rows[0]!.id;
  const loan = await committedLoan({ business, admin, clientId }, "CT-000001", 300);
  return { business, box, admin, clientId, ...loan };
}

async function committedLoan(
  w: { business: string; admin: string; clientId: string },
  number: string,
  principal: number,
) {
  const client = await pool.connect();
  try {
    await client.query("begin");
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
            scheduled_amount, disbursed_on, first_due_on, frequency, installment_count, created_by)
         values ($1, $2, $3, 0, 0, $3, $3, '2026-10-13', '2026-10-14', 'DIARIA', 3, $4) returning id`,
        [w.business, contract, principal, w.admin],
      )
    ).rows[0]!.id;
    const installments: string[] = [];
    for (const n of [1, 2, 3]) {
      installments.push(
        (
          await client.query<{ id: string }>(
            "insert into public.installments (business_id, loan_id, number, due_on, amount) values ($1, $2, $3, date '2026-10-14' + ($3::int - 1), $4) returning id",
            [w.business, loanId, n, principal / 3],
          )
        ).rows[0]!.id,
      );
    }
    await client.query("commit");
    return { loanId, installments };
  } finally {
    client.release();
  }
}

async function cobro(client: pg.PoolClient, w: World, amount: number, author = w.admin) {
  return (
    await client.query<{ id: string }>(
      `insert into public.cash_movements (business_id, cashbox_id, type, direction, amount, created_by)
       values ($1, $2, 'COBRO', 'ENTRADA', $3, $4) returning id`,
      [w.business, w.box, amount, author],
    )
  ).rows[0]!.id;
}

/** Pago de cuotas con sus aplicaciones, dentro de la transacción del cliente. */
async function pay(
  client: pg.PoolClient,
  w: World,
  parts: { installment: number; amount: number }[],
) {
  const total = parts.reduce((sum, part) => sum + part.amount, 0);
  const movementId = await cobro(client, w, total);
  const paymentId = (
    await client.query<{ id: string }>(
      `insert into public.payments (business_id, loan_id, kind, amount, movement_id, registered_by)
       values ($1, $2, 'CUOTAS', $3, $4, $5) returning id`,
      [w.business, w.loanId, total, movementId, w.admin],
    )
  ).rows[0]!.id;
  for (const [index, part] of parts.entries()) {
    await client.query(
      "insert into public.payment_applications (business_id, payment_id, installment_id, amount, position) values ($1, $2, $3, $4, $5)",
      [w.business, paymentId, w.installments[part.installment]!, part.amount, index + 1],
    );
  }
  return { paymentId, movementId };
}

/** Ejecuta `work` en su propia transacción real; devuelve el error si falla al confirmar. */
async function inTransaction(
  work: (client: pg.PoolClient) => Promise<void>,
  holdMs = 0,
): Promise<pg.DatabaseError | null> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await work(client);
    if (holdMs) await sleep(holdMs);
    await client.query("commit");
    return null;
  } catch (error) {
    await client.query("rollback");
    return error as pg.DatabaseError;
  } finally {
    client.release();
  }
}

describe("aplicación cronológica", () => {
  const run = (parts: { installment: number; amount: number }[]) =>
    withRollback(pool, async (client) => {
      const w = await world();
      await pay(client, w, parts);
      return attempt(client, "set constraints all immediate");
    });

  it("exige pagar la cuota pendiente más antigua primero: sin saltarse cuotas ni desordenar posiciones", async () => {
    expect(
      await run([
        { installment: 0, amount: 100 },
        { installment: 1, amount: 40 },
      ]),
    ).toBeNull();
    expect((await run([{ installment: 1, amount: 50 }]))?.constraint, "salta la cuota 1").toBe(
      "payment_chronological",
    );
    expect(
      (
        await run([
          { installment: 0, amount: 60 },
          { installment: 1, amount: 40 },
        ])
      )?.constraint,
      "cuota 1 incompleta",
    ).toBe("payment_chronological");
    expect(
      (
        await run([
          { installment: 1, amount: 40 },
          { installment: 0, amount: 100 },
        ])
      )?.constraint,
      "posiciones al revés",
    ).toBe("payment_chronological");
  });
});

describe("consistencia con la caja", () => {
  it("un COBRO de otro autor, o ya reversado, no sirve para un pago", async () => {
    await withRollback(pool, async (client) => {
      const w = await world();
      const other = (await fixtures.account({ role: "COBRADOR", businessId: w.business })).userId;
      const insert = (movementId: string, registeredBy: string) =>
        attempt(
          client,
          "insert into public.payments (business_id, loan_id, kind, amount, movement_id, registered_by) values ($1, $2, 'CUOTAS', 10, $3, $4)",
          [w.business, w.loanId, movementId, registeredBy],
        );

      // Autor del COBRO distinto al que registra el pago.
      expect((await insert(await cobro(client, w, 10, other), w.admin))?.code).toBe(
        CHECK_VIOLATION,
      );

      // COBRO que ya tiene un REVERSO.
      const reversed = await cobro(client, w, 10);
      await client.query(
        `insert into public.cash_movements (business_id, cashbox_id, type, direction, amount, reason, reverses_movement_id, created_by)
         values ($1, $2, 'REVERSO', 'SALIDA', 10, 'x', $3, $4)`,
        [w.business, w.box, reversed, w.admin],
      );
      expect((await insert(reversed, w.admin))?.code).toBe(CHECK_VIOLATION);
    });
  });

  it("el REVERSO de caja del COBRO de un pago exige el reverso del pago en la misma transacción", async () => {
    await withRollback(pool, async (client) => {
      const w = await world();
      const paid = await pay(client, w, [{ installment: 0, amount: 100 }]);
      await client.query(
        `insert into public.cash_movements (business_id, cashbox_id, type, direction, amount, reason, reverses_movement_id, created_by)
         values ($1, $2, 'REVERSO', 'SALIDA', 100, 'x', $3, $4)`,
        [w.business, w.box, paid.movementId, w.admin],
      );

      expect((await attempt(client, "set constraints all immediate"))?.constraint).toBe(
        "payment_cash_reversal_linked",
      );
    });
  });
});

describe("estados del préstamo", () => {
  it("no se reversan ni se pagan préstamos que ya no están ACTIVOS", async () => {
    await withRollback(pool, async (client) => {
      const w = await world();
      const paid = await pay(client, w, [{ installment: 0, amount: 100 }]);
      await client.query("set constraints all deferred");
      // Refinanciado «a mano» (la regla diferida lo rechazaría al confirmar): aquí solo interesa el estado.
      await client.query("update public.loans set status = 'REFINANCIADO' where id = $1", [
        w.loanId,
      ]);
      const reversalMovement = (
        await client.query<{ id: string }>(
          `insert into public.cash_movements (business_id, cashbox_id, type, direction, amount, reason, reverses_movement_id, created_by)
           values ($1, $2, 'REVERSO', 'SALIDA', 100, 'x', $3, $4) returning id`,
          [w.business, w.box, paid.movementId, w.admin],
        )
      ).rows[0]!.id;

      expect(
        (
          await attempt(
            client,
            "insert into public.payment_reversals (business_id, payment_id, reason, movement_id, reversed_by) values ($1, $2, 'x', $3, $4)",
            [w.business, paid.paymentId, reversalMovement, w.admin],
          )
        )?.code,
      ).toBe(CHECK_VIOLATION);
    });
  });

  it("REFINANCIADO sin su refinanciación, o un préstamo anterior sin ella, se rechaza al confirmar", async () => {
    await withRollback(pool, async (client) => {
      const w = await world();
      await client.query("update public.loans set status = 'REFINANCIADO' where id = $1", [
        w.loanId,
      ]);
      expect((await attempt(client, "set constraints all immediate"))?.constraint).toBe(
        "refinanced_loan_has_refinancing",
      );
    });
  });
});

describe("concurrencia (conexiones reales)", () => {
  it("dos pagos simultáneos de la misma cuota que juntos la sobrepasan: uno se aplica y el otro se rechaza", async () => {
    const w = await world();
    const attemptPay = () =>
      inTransaction(
        (client) => pay(client, w, [{ installment: 0, amount: 70 }]).then(() => undefined),
        300,
      );

    const [a, b] = await Promise.all([attemptPay(), attemptPay()]);

    expect([a, b].filter((error) => error === null)).toHaveLength(1);
    const failure = (a ?? b)!;
    expect(failure.constraint).toBe("payment_within_balance");
    const applied = await pool.query<{ n: string }>(
      "select private.installment_applied($1)::text as n",
      [w.installments[0]],
    );
    expect(applied.rows[0]!.n).toBe("70");
  });

  it("un reverso y un pago nuevo simultáneos del mismo préstamo no dejan un pago anterior reversado con uno posterior vigente", async () => {
    const w = await world();
    const first = await inTransaction(async (client) => {
      await pay(client, w, [{ installment: 0, amount: 100 }]);
    });
    expect(first).toBeNull();
    const original = (
      await pool.query<{ id: string; movement_id: string }>(
        "select id, movement_id from public.payments where loan_id = $1",
        [w.loanId],
      )
    ).rows[0]!;

    const reversal = inTransaction(async (client) => {
      const movement = (
        await client.query<{ id: string }>(
          `insert into public.cash_movements (business_id, cashbox_id, type, direction, amount, reason, reverses_movement_id, created_by)
           values ($1, $2, 'REVERSO', 'SALIDA', 100, 'x', $3, $4) returning id`,
          [w.business, w.box, original.movement_id, w.admin],
        )
      ).rows[0]!.id;
      await client.query(
        "insert into public.payment_reversals (business_id, payment_id, reason, movement_id, reversed_by) values ($1, $2, 'x', $3, $4)",
        [w.business, original.id, movement, w.admin],
      );
    }, 300);
    await sleep(50);
    const next = inTransaction(async (client) => {
      await pay(client, w, [{ installment: 0, amount: 100 }]);
    }, 0);

    const [r, n] = await Promise.all([reversal, next]);

    // El reverso tomó el préstamo primero: el pago nuevo esperó, y quedó reversado el anterior con uno
    // posterior vigente solo en el orden válido (reverso → pago nuevo). Nunca al revés.
    expect(r).toBeNull();
    expect(n).toBeNull();
    const state = await pool.query<{ reversed: boolean }>(
      `select exists (select 1 from public.payment_reversals r where r.payment_id = p.id) as reversed
         from public.payments p where p.loan_id = $1 order by p.seq`,
      [w.loanId],
    );
    expect(state.rows.map((row) => row.reversed)).toEqual([true, false]);
  });
});
