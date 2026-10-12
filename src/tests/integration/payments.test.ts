import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { registerCapitalIncome } from "@/modules/cash/commands";
import { getCashSummary } from "@/modules/cash/queries";
import { loadSessionContext, type SessionContext } from "@/modules/identity/session";
import { createClient } from "@/modules/portfolio/clients";
import { annulContract, confirmContract } from "@/modules/portfolio/contracts";
import { getLoanDetail } from "@/modules/portfolio/loan-queries";
import { registerPayment, reversePayment } from "@/modules/portfolio/payments";
import { isoDate } from "@/shared/dates/dates";
import { AppError } from "@/shared/errors/app-error";
import type { IdempotencyKey } from "@/shared/ids/idempotency-key";
import { TestFixtures, createAdminClient } from "./helpers/auth";
import { createTestPool } from "./helpers/db";

// F4-T3 (02 §3.1–3.2, ADR 0008): pagos aplicados en orden cronológico, sin saldo a favor, con reverso
// solo del último pago, todo en una transacción y de forma idempotente.

const pool = createTestPool();
const fixtures = new TestFixtures(pool, createAdminClient());
const deps = { db: pool };

afterAll(async () => {
  await fixtures.purge();
  await pool.end();
});

const key = () => randomUUID() as IdempotencyKey;
const now = () => new Date("2026-10-13T17:00:00Z"); // 13/10/2026 12:00 en Bogotá

/** Préstamo de $300.000 sin interés en 3 cuotas de $100.000 (14, 15 y 16 de octubre). */
async function setup(funds = 1_000_000) {
  const businessId = await fixtures.business("Pagos");
  const account = await fixtures.account({ role: "ADMIN_NEGOCIO", businessId });
  const admin: SessionContext = await loadSessionContext(account.userId, pool);
  const client = await createClient(deps, admin, {
    name: "Ana",
    identification: randomUUID().slice(0, 8),
  });
  await registerCapitalIncome(deps, admin, { idempotencyKey: key(), amount: funds });
  const loan = await confirmContract(
    deps,
    admin,
    {
      clientId: client.id,
      principal: 300_000,
      interestBps: 0,
      frequency: "DIARIA",
      installmentCount: 3,
      firstDueOn: isoDate("2026-10-14"),
      idempotencyKey: key(),
    },
    now,
  );
  return { businessId, admin, clientId: client.id, loanId: loan.result.loanId };
}

const pay = (
  s: Awaited<ReturnType<typeof setup>>,
  amount: number,
  extra: { idempotencyKey?: IdempotencyKey; note?: string } = {},
) =>
  registerPayment(deps, s.admin, {
    idempotencyKey: extra.idempotencyKey ?? key(),
    loanId: s.loanId,
    amount,
    note: extra.note,
  });

const detail = (s: Awaited<ReturnType<typeof setup>>) =>
  getLoanDetail(pool, s.admin, s.loanId, now());
const cashBalance = async (s: Awaited<ReturnType<typeof setup>>) =>
  (await getCashSummary(pool, s.admin)).balance;

async function failureOf(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("se esperaba un AppError");
}

describe("registrar un pago", () => {
  it("un pago parcial deja el saldo en su cuota original y no toca la última", async () => {
    const s = await setup();
    const funds = await cashBalance(s);

    const outcome = await pay(s, 50_000, { note: "Abono del lunes" });

    expect(outcome.result.applications).toEqual([
      { installmentNumber: 1, applied: 50_000, pendingAfter: 50_000 },
    ]);
    expect(outcome.result).toMatchObject({
      loanPendingBalance: 250_000,
      loanPaid: false,
      amount: 50_000,
    });
    expect(await cashBalance(s)).toBe(funds + 50_000);

    const loan = await detail(s);
    expect(
      loan!.installments.map((i) => [i.number, i.appliedAmount, i.pendingAmount, i.status]),
    ).toEqual([
      [1, 50_000, 50_000, "PARCIAL"],
      [2, 0, 100_000, "PENDIENTE"],
      [3, 0, 100_000, "PENDIENTE"],
    ]);
    // El calendario original no cambia: las tres cuotas siguen valiendo lo mismo.
    expect(loan!.installments.map((i) => i.amount)).toEqual([100_000, 100_000, 100_000]);
    expect(loan!.payments[0]).toMatchObject({
      amount: 50_000,
      note: "Abono del lunes",
      canReverse: true,
      reversal: null,
    });
  });

  it("un pago mayor cubre las cuotas en orden cronológico y el excedente pasa a la siguiente", async () => {
    const s = await setup();
    await pay(s, 30_000);

    const outcome = await pay(s, 150_000);

    expect(outcome.result.applications).toEqual([
      { installmentNumber: 1, applied: 70_000, pendingAfter: 0 },
      { installmentNumber: 2, applied: 80_000, pendingAfter: 20_000 },
    ]);
    const loan = await detail(s);
    expect(loan!.installments.map((i) => [i.number, i.pendingAmount, i.status])).toEqual([
      [1, 0, "PAGADA"],
      [2, 20_000, "PARCIAL"],
      [3, 100_000, "PENDIENTE"],
    ]);
    expect(loan!.pendingBalance).toBe(120_000);
  });

  it("no admite un pago superior al saldo ni crea saldo a favor", async () => {
    const s = await setup();
    await pay(s, 250_000);
    const funds = await cashBalance(s);

    const error = await failureOf(pay(s, 50_001));

    expect(error).toMatchObject({ code: "PAYMENT_EXCEEDS_BALANCE", status: 409 });
    expect(error.message).toContain("$50.000");
    expect(await cashBalance(s)).toBe(funds);
    const exact = await pay(s, 50_000);
    expect(exact.result).toMatchObject({ loanPendingBalance: 0, loanPaid: true });
    expect((await detail(s))!.status).toBe("PAGADO");
    // Un préstamo pagado ya no recibe nada más.
    expect(await failureOf(pay(s, 1))).toMatchObject({ code: "LOAN_PAID" });
  });

  it("deja la auditoría completa: pago, aplicación, cuotas pagadas y préstamo pagado", async () => {
    const s = await setup();
    await pay(s, 100_000);
    await pay(s, 200_000);

    const events = await pool.query<{ action: string; entity_type: string }>(
      `select action, entity_type from public.audit_events
        where business_id = $1 and action in ('PagoRegistrado','PagoAplicado','CuotaPagada','PrestamoPagado')
        order by occurred_at, action`,
      [s.businessId],
    );
    const counts = events.rows.reduce<Record<string, number>>(
      (acc, e) => ({ ...acc, [e.action]: (acc[e.action] ?? 0) + 1 }),
      {},
    );
    expect(counts).toEqual({
      PagoRegistrado: 2,
      PagoAplicado: 2,
      CuotaPagada: 3,
      PrestamoPagado: 1,
    });
  });

  it("es idempotente: reenviar la misma clave no cobra dos veces; con otro monto es un 409", async () => {
    const s = await setup();
    const idempotencyKey = key();
    const funds = await cashBalance(s);

    const first = await pay(s, 100_000, { idempotencyKey });
    const again = await pay(s, 100_000, { idempotencyKey });

    expect(again).toEqual({ result: first.result, replayed: true });
    expect(await failureOf(pay(s, 90_000, { idempotencyKey }))).toMatchObject({
      code: "IDEMPOTENCY_KEY_REUSED",
    });
    expect(await cashBalance(s)).toBe(funds + 100_000);
    expect((await detail(s))!.payments).toHaveLength(1);
  });

  it("seis envíos simultáneos con la misma clave cobran una sola vez", async () => {
    const s = await setup();
    const idempotencyKey = key();

    const outcomes = await Promise.all(
      Array.from({ length: 6 }, () => pay(s, 100_000, { idempotencyKey })),
    );

    expect(outcomes.filter((o) => !o.replayed)).toHaveLength(1);
    expect((await detail(s))!.payments).toHaveLength(1);
  });

  it("dos pagos simultáneos distintos que juntos superan el saldo: uno se aplica y el otro se rechaza", async () => {
    const s = await setup();

    const outcomes = await Promise.allSettled([pay(s, 200_000), pay(s, 200_000)]);

    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((o) => o.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "PAYMENT_EXCEEDS_BALANCE" });
    expect((await detail(s))!.pendingBalance).toBe(100_000);
  });

  it("un préstamo ajeno es «no encontrado», un anulado no recibe pagos y un cobrador recibe 403 con RECHAZADO", async () => {
    const mine = await setup();
    const other = await setup();
    const collector = await loadSessionContext(
      (await fixtures.account({ role: "COBRADOR", businessId: mine.businessId })).userId,
      pool,
    );

    expect(
      await failureOf(
        registerPayment(deps, mine.admin, {
          idempotencyKey: key(),
          loanId: other.loanId,
          amount: 1000,
        }),
      ),
    ).toMatchObject({ code: "LOAN_NOT_FOUND", status: 404 });
    expect(
      await failureOf(
        registerPayment(deps, collector, {
          idempotencyKey: key(),
          loanId: mine.loanId,
          amount: 1000,
        }),
      ),
    ).toMatchObject({ code: "FORBIDDEN" });
    const rejected = await pool.query(
      "select 1 from public.audit_events where business_id = $1 and action = 'RegistrarPago' and result = 'RECHAZADO'",
      [mine.businessId],
    );
    expect(rejected.rowCount).toBe(1);

    await annulContract(deps, mine.admin, {
      idempotencyKey: key(),
      loanId: mine.loanId,
      reason: "Error",
    });
    expect(await failureOf(pay(mine, 1000))).toMatchObject({ code: "LOAN_NOT_ACTIVE" });
  });
});

describe("reverso de pagos", () => {
  it("restaura cuotas y caja sin borrar el pago original", async () => {
    const s = await setup();
    const funds = await cashBalance(s);
    const paid = await pay(s, 150_000);
    expect(await cashBalance(s)).toBe(funds + 150_000);

    const reversed = await reversePayment(deps, s.admin, {
      idempotencyKey: key(),
      paymentId: paid.result.paymentId,
      reason: "Se registró en el cliente equivocado",
    });

    expect(reversed.result).toMatchObject({
      amount: 150_000,
      loanPendingBalance: 300_000,
      balance: funds,
    });
    expect(await cashBalance(s)).toBe(funds);
    const loan = await detail(s);
    expect(loan!.installments.map((i) => [i.number, i.appliedAmount, i.pendingAmount])).toEqual([
      [1, 0, 100_000],
      [2, 0, 100_000],
      [3, 0, 100_000],
    ]);
    // El pago y sus aplicaciones siguen en el historial, marcados como reversados.
    expect(loan!.payments).toHaveLength(1);
    expect(loan!.payments[0]).toMatchObject({
      amount: 150_000,
      canReverse: false,
      reversal: { reason: "Se registró en el cliente equivocado" },
    });
    expect(loan!.payments[0]!.applications).toHaveLength(2);
    // Y el movimiento original de caja sigue ahí, con su reverso vinculado.
    const movements = await pool.query<{ type: string; reverses: string | null }>(
      "select type, reverses_movement_id as reverses from public.cash_movements where id = any($1) order by type",
      [[paid.result.movementId, reversed.result.movementId]],
    );
    expect(movements.rows).toEqual([
      { type: "COBRO", reverses: null },
      { type: "REVERSO", reverses: paid.result.movementId },
    ]);
  });

  it("solo se reversa el pago más reciente: antes hay que reversar los posteriores, y cada reverso restaura lo suyo", async () => {
    const s = await setup();
    const first = await pay(s, 100_000);
    const second = await pay(s, 60_000);

    expect(
      await failureOf(
        reversePayment(deps, s.admin, {
          idempotencyKey: key(),
          paymentId: first.result.paymentId,
          reason: "x",
        }),
      ),
    ).toMatchObject({ code: "PAYMENT_NOT_LATEST", status: 409 });

    await reversePayment(deps, s.admin, {
      idempotencyKey: key(),
      paymentId: second.result.paymentId,
      reason: "x",
    });
    expect((await detail(s))!.installments.map((i) => i.appliedAmount)).toEqual([100_000, 0, 0]);
    await reversePayment(deps, s.admin, {
      idempotencyKey: key(),
      paymentId: first.result.paymentId,
      reason: "x",
    });
    expect((await detail(s))!.installments.map((i) => i.appliedAmount)).toEqual([0, 0, 0]);
    expect(
      await failureOf(
        reversePayment(deps, s.admin, {
          idempotencyKey: key(),
          paymentId: first.result.paymentId,
          reason: "x",
        }),
      ),
    ).toMatchObject({ code: "PAYMENT_ALREADY_REVERSED" });
  });

  it("tras reversar, la cuota admite un pago nuevo por su valor completo", async () => {
    const s = await setup();
    const first = await pay(s, 100_000);
    await reversePayment(deps, s.admin, {
      idempotencyKey: key(),
      paymentId: first.result.paymentId,
      reason: "x",
    });

    const again = await pay(s, 100_000);

    expect(again.result.applications).toEqual([
      { installmentNumber: 1, applied: 100_000, pendingAfter: 0 },
    ]);
  });

  it("es idempotente, audita con motivo y la caja puede rechazarlo si ya no tiene el dinero", async () => {
    const s = await setup(300_000); // la caja queda en 0 tras el desembolso
    const paid = await pay(s, 100_000);
    const idempotencyKey = key();
    const input = { idempotencyKey, paymentId: paid.result.paymentId, reason: "Error de captura" };

    // Se gasta el dinero cobrado: reversar el pago dejaría la Caja Mayor en negativo.
    await pool.query(
      `insert into public.cash_movements (business_id, cashbox_id, type, direction, amount, created_by)
       select $1, id, 'GASTO_CAJA_MAYOR', 'SALIDA', 100000, $2 from public.main_cashboxes where business_id = $1`,
      [s.businessId, s.admin.userId],
    );
    expect(await failureOf(reversePayment(deps, s.admin, input))).toMatchObject({
      code: "INSUFFICIENT_FUNDS",
    });
    expect((await detail(s))!.payments[0]!.reversal).toBeNull();

    await registerCapitalIncome(deps, s.admin, { idempotencyKey: key(), amount: 100_000 });
    const first = await reversePayment(deps, s.admin, input);
    const again = await reversePayment(deps, s.admin, input);
    expect(again).toEqual({ result: first.result, replayed: true });
    const audit = await pool.query<{ summary: { reason: string; amount: number } }>(
      "select summary from public.audit_events where business_id = $1 and action = 'PagoReversado'",
      [s.businessId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]!.summary).toMatchObject({ reason: "Error de captura", amount: 100_000 });
  });

  it("un pago de otro negocio es «no encontrado» y un cobrador recibe 403", async () => {
    const mine = await setup();
    const other = await setup();
    const foreign = await pay(other, 10_000);
    const collector = await loadSessionContext(
      (await fixtures.account({ role: "COBRADOR", businessId: mine.businessId })).userId,
      pool,
    );

    expect(
      await failureOf(
        reversePayment(deps, mine.admin, {
          idempotencyKey: key(),
          paymentId: foreign.result.paymentId,
          reason: "x",
        }),
      ),
    ).toMatchObject({ code: "PAYMENT_NOT_FOUND", status: 404 });
    expect(
      await failureOf(
        reversePayment(deps, collector, {
          idempotencyKey: key(),
          paymentId: foreign.result.paymentId,
          reason: "x",
        }),
      ),
    ).toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("anular un contrato con pagos", () => {
  it("se rechaza con pagos vigentes y se permite una vez reversados", async () => {
    const s = await setup();
    const paid = await pay(s, 100_000);

    expect(
      await failureOf(
        annulContract(deps, s.admin, { idempotencyKey: key(), loanId: s.loanId, reason: "Error" }),
      ),
    ).toMatchObject({ code: "CONTRACT_HAS_PAYMENTS", status: 409 });

    await reversePayment(deps, s.admin, {
      idempotencyKey: key(),
      paymentId: paid.result.paymentId,
      reason: "x",
    });
    const annulled = await annulContract(deps, s.admin, {
      idempotencyKey: key(),
      loanId: s.loanId,
      reason: "Error",
    });
    expect(annulled.replayed).toBe(false);
    expect((await detail(s))!.status).toBe("ANULADO");
  });
});

describe("barreras adicionales de pagos y reversos", () => {
  it("canReverse solo es verdadero para el último pago no reversado", async () => {
    const s = await setup();
    await pay(s, 100_000);
    await pay(s, 60_000);

    const loan = await detail(s);

    expect(loan!.payments.map((p) => [p.amount, p.canReverse])).toEqual([
      [60_000, true],
      [100_000, false],
    ]);
  });

  it("la nota del pago y el motivo del reverso quedan en los movimientos de caja", async () => {
    const s = await setup();
    const paid = await pay(s, 40_000, { note: "Pagó en efectivo" });
    const reversed = await reversePayment(deps, s.admin, {
      idempotencyKey: key(),
      paymentId: paid.result.paymentId,
      reason: "Cliente equivocado",
    });

    const rows = await pool.query<{ id: string; note: string | null; reason: string | null }>(
      "select id, note, reason from public.cash_movements where id = any($1)",
      [[paid.result.movementId, reversed.result.movementId]],
    );
    const byId = Object.fromEntries(rows.rows.map((row) => [row.id, row]));
    expect(byId[paid.result.movementId]).toMatchObject({ note: "Pagó en efectivo" });
    expect(byId[reversed.result.movementId]).toMatchObject({
      reason: "Reverso del pago: Cliente equivocado",
    });
  });

  it("una cuota vencida con un pago parcial sigue VENCIDA y cuenta sus días de mora", async () => {
    const s = await setup();
    await pay(s, 30_000);

    const later = new Date("2026-10-17T17:00:00Z"); // las cuotas 1, 2 y 3 (14, 15 y 16) ya vencieron
    const loan = await getLoanDetail(pool, s.admin, s.loanId, later);

    expect(
      loan!.installments.map((i) => [i.number, i.status, i.daysLate, i.appliedAmount]),
    ).toEqual([
      [1, "VENCIDA", 3, 30_000],
      [2, "VENCIDA", 2, 0],
      [3, "VENCIDA", 1, 0],
    ]);
    expect(loan!.overdueBalance).toBe(270_000);
  });

  it("un pago y un reverso simultáneos no dejan el préstamo en un estado imposible", async () => {
    const s = await setup();
    const first = await pay(s, 100_000);

    const outcomes = await Promise.allSettled([
      reversePayment(deps, s.admin, {
        idempotencyKey: key(),
        paymentId: first.result.paymentId,
        reason: "x",
      }),
      pay(s, 50_000),
    ]);

    // Dos órdenes válidos: (a) el reverso va primero y el pago nuevo después (queda 50.000 aplicado), o
    // (b) el pago nuevo va primero y entonces el reverso del anterior se rechaza (quedan 150.000).
    const loan = await detail(s);
    const applied = loan!.installments.reduce((sum, i) => sum + i.appliedAmount, 0);
    const [reversal, payment] = outcomes;
    expect(payment!.status).toBe("fulfilled");
    if (reversal!.status === "fulfilled") {
      expect(applied).toBe(50_000);
    } else {
      expect(reversal!.reason).toMatchObject({ code: "PAYMENT_NOT_LATEST" });
      expect(applied).toBe(150_000);
    }
  });

  it("dos reversos simultáneos del mismo pago con claves distintas: uno se aplica y el otro es un 409", async () => {
    const s = await setup();
    const paid = await pay(s, 100_000);

    const outcomes = await Promise.allSettled(
      [1, 2].map(() =>
        reversePayment(deps, s.admin, {
          idempotencyKey: key(),
          paymentId: paid.result.paymentId,
          reason: "x",
        }),
      ),
    );

    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((o) => o.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "PAYMENT_ALREADY_REVERSED" });
  });
});
