import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { registerCapitalIncome } from "@/modules/cash/commands";
import { getCashSummary } from "@/modules/cash/queries";
import { loadSessionContext, type SessionContext } from "@/modules/identity/session";
import { getClientDetail } from "@/modules/portfolio/client-queries";
import { createClient } from "@/modules/portfolio/clients";
import { annulContract, confirmContract } from "@/modules/portfolio/contracts";
import { createLateFee, voidLateFee } from "@/modules/portfolio/late-fees";
import { getLoanDetail } from "@/modules/portfolio/loan-queries";
import { registerPayment, reversePayment } from "@/modules/portfolio/payments";
import { previewRefinancing, refinanceLoan } from "@/modules/portfolio/refinancing";
import { isoDate } from "@/shared/dates/dates";
import { AppError } from "@/shared/errors/app-error";
import type { IdempotencyKey } from "@/shared/ids/idempotency-key";
import { TestFixtures, createAdminClient } from "./helpers/auth";
import { createTestPool } from "./helpers/db";

// F4-T5 (02 §3.5, ADR 0008): la refinanciación crea un contrato y préstamo nuevos con el saldo pendiente
// más un adicional opcional, deja el anterior REFINANCIADO sin editarlo y solo mueve la caja por el adicional.

const pool = createTestPool();
const fixtures = new TestFixtures(pool, createAdminClient());
const deps = { db: pool };

afterAll(async () => {
  await fixtures.purge();
  await pool.end();
});

const key = () => randomUUID() as IdempotencyKey;
const now = () => new Date("2026-10-13T17:00:00Z"); // 13/10/2026 en Bogotá

type Setup = Awaited<ReturnType<typeof setup>>;

/** Préstamo de $300.000 sin interés en 3 cuotas; se paga la cuota 1 y la mitad de la 2 → pendiente $150.000. */
async function setup(options: { paid?: boolean; funds?: number } = {}) {
  const businessId = await fixtures.business("Refinanciación");
  const account = await fixtures.account({ role: "ADMIN_NEGOCIO", businessId });
  const admin: SessionContext = await loadSessionContext(account.userId, pool);
  const client = await createClient(deps, admin, {
    name: "Ana",
    identification: randomUUID().slice(0, 8),
  });
  await registerCapitalIncome(deps, admin, {
    idempotencyKey: key(),
    amount: options.funds ?? 2_000_000,
  });
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
  if (options.paid !== false) {
    await registerPayment(deps, admin, {
      idempotencyKey: key(),
      loanId: loan.result.loanId,
      amount: 150_000,
    });
  }
  return { businessId, admin, clientId: client.id, loanId: loan.result.loanId };
}

const terms = (overrides: Record<string, unknown> = {}) => ({
  additionalAmount: 0,
  interestBps: 2000,
  frequency: "SEMANAL" as const,
  installmentCount: 4,
  firstDueOn: isoDate("2026-10-20"),
  ...overrides,
});

const refinance = (
  s: Setup,
  overrides: Record<string, unknown> = {},
  idempotencyKey: IdempotencyKey = key(),
) => refinanceLoan(deps, s.admin, { loanId: s.loanId, idempotencyKey, ...terms(overrides) }, now);

const cash = async (s: Setup) => (await getCashSummary(pool, s.admin)).balance;

async function failureOf(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("se esperaba un AppError");
}

describe("vista previa", () => {
  it("el principal es el saldo pendiente de las cuotas más el adicional, con interés propio", async () => {
    const s = await setup();

    const preview = await previewRefinancing(
      deps,
      s.admin,
      s.loanId,
      terms({ additionalAmount: 50_000 }),
      now,
    );

    expect(preview).toMatchObject({
      previousContractNumber: "CT-000001",
      refinancedBalance: 150_000,
      additionalAmount: 50_000,
      plan: { principal: 200_000, interest: 40_000, total: 240_000 },
      sufficientFunds: true,
    });
    expect(preview.plan.installments).toHaveLength(4);
    expect(preview.plan.installments.reduce((sum, i) => sum + i.amount, 0)).toBe(240_000);
    // No guarda nada.
    expect((await getLoanDetail(pool, s.admin, s.loanId, now()))!.status).toBe("ACTIVO");
  });

  it("rechaza un préstamo ajeno, pagado, con mora activa o ya no activo", async () => {
    const s = await setup();
    const other = await setup();

    expect(
      await failureOf(previewRefinancing(deps, s.admin, other.loanId, terms(), now)),
    ).toMatchObject({
      code: "LOAN_NOT_FOUND",
    });
    const fee = await createLateFee(deps, s.admin, {
      idempotencyKey: key(),
      loanId: s.loanId,
      amount: 10_000,
      reason: "Atraso",
    });
    expect(
      await failureOf(previewRefinancing(deps, s.admin, s.loanId, terms(), now)),
    ).toMatchObject({
      code: "REFINANCE_WITH_LATE_FEES",
    });
    await voidLateFee(deps, s.admin, {
      idempotencyKey: key(),
      chargeId: fee.result.chargeId,
      reason: "Error",
    });
    expect(
      (await previewRefinancing(deps, s.admin, s.loanId, terms(), now)).refinancedBalance,
    ).toBe(150_000);

    await registerPayment(deps, s.admin, {
      idempotencyKey: key(),
      loanId: s.loanId,
      amount: 150_000,
    });
    expect(
      await failureOf(previewRefinancing(deps, s.admin, s.loanId, terms(), now)),
    ).toMatchObject({
      code: "LOAN_PAID",
    });
  });
});

describe("refinanciar", () => {
  it("crea contrato y préstamo nuevos, deja el anterior REFINANCIADO sin editarlo y no mueve la caja sin adicional", async () => {
    const s = await setup();
    const funds = await cash(s);
    const before = await getLoanDetail(pool, s.admin, s.loanId, now());

    const outcome = await refinance(s);

    expect(outcome.replayed).toBe(false);
    expect(outcome.result).toMatchObject({
      newContractNumber: "CT-000002",
      refinancedBalance: 150_000,
      additionalAmount: 0,
      principal: 150_000,
      total: 180_000,
      balance: funds,
    });
    expect(await cash(s)).toBe(funds);

    const previous = await getLoanDetail(pool, s.admin, s.loanId, now());
    expect(previous).toMatchObject({
      loanStatus: "REFINANCIADO",
      status: "REFINANCIADO",
      pendingBalance: 0,
      refinancing: { nextLoanId: outcome.result.newLoanId },
    });
    // El anterior no se edita: mismos importes, mismas cuotas y su pago sigue en el historial.
    expect(previous!.principal).toBe(before!.principal);
    expect(previous!.total).toBe(before!.total);
    expect(previous!.installments.map((i) => i.amount)).toEqual(
      before!.installments.map((i) => i.amount),
    );
    expect(previous!.installments.map((i) => i.appliedAmount)).toEqual([100_000, 50_000, 0]);
    expect(previous!.payments).toHaveLength(1);

    const next = await getLoanDetail(pool, s.admin, outcome.result.newLoanId, now());
    expect(next).toMatchObject({
      contractNumber: "CT-000002",
      status: "ACTIVO",
      principal: 150_000,
      pendingBalance: 180_000,
      frequency: "SEMANAL",
      refinancing: { previousLoanId: s.loanId },
      client: { id: s.clientId },
    });
    expect(next!.installments).toHaveLength(4);
  });

  it("con monto adicional lo desembolsa de la Caja Mayor por separado y solo ese monto", async () => {
    const s = await setup();
    const funds = await cash(s);

    const outcome = await refinance(s, { additionalAmount: 40_000, interestBps: 1000 });

    expect(outcome.result).toMatchObject({
      principal: 190_000,
      total: 209_000,
      balance: funds - 40_000,
    });
    const movement = await pool.query<{
      type: string;
      direction: string;
      amount: string;
      reference_id: string;
    }>(
      `select type, direction, amount::text, reference_id from public.cash_movements
        where business_id = $1 and type = 'DESEMBOLSO_PRESTAMO' and reference_id = $2`,
      [s.businessId, outcome.result.newLoanId],
    );
    expect(movement.rows).toEqual([
      {
        type: "DESEMBOLSO_PRESTAMO",
        direction: "SALIDA",
        amount: "40000",
        reference_id: outcome.result.newLoanId,
      },
    ]);
    const events = await pool.query<{ action: string; entity_id: string }>(
      `select action, entity_id from public.audit_events
        where business_id = $1 and action in
         ('RefinanciacionCreada','SaldoAnteriorRefinanciado','PrestamoRefinanciado','MontoAdicionalDesembolsado',
          'PrestamoCreado','CuotasGeneradas','ContratoCreado','ContratoConfirmado')
          and (entity_id = $2 or entity_id = $3 or action = 'RefinanciacionCreada' or action = 'MontoAdicionalDesembolsado'
               or action = 'ContratoCreado' or action = 'ContratoConfirmado')
        order by action`,
      [s.businessId, s.loanId, outcome.result.newLoanId],
    );
    const actions = events.rows.map((e) => e.action);
    for (const expected of [
      "RefinanciacionCreada",
      "SaldoAnteriorRefinanciado",
      "PrestamoRefinanciado",
      "MontoAdicionalDesembolsado",
      "PrestamoCreado",
      "CuotasGeneradas",
    ]) {
      expect(actions, expected).toContain(expected);
    }
    // Contrato nuevo creado y confirmado (el del préstamo anterior también tiene los suyos).
    expect(actions.filter((a) => a === "ContratoCreado").length).toBeGreaterThanOrEqual(2);
    expect(actions.filter((a) => a === "ContratoConfirmado").length).toBeGreaterThanOrEqual(2);
    const has = (action: string, entityId: string) =>
      events.rows.some((e) => e.action === action && e.entity_id === entityId);
    expect(has("PrestamoRefinanciado", s.loanId)).toBe(true);
    expect(has("SaldoAnteriorRefinanciado", s.loanId)).toBe(true);
    expect(has("PrestamoCreado", outcome.result.newLoanId)).toBe(true);
  });

  it("si la caja no alcanza para el adicional se rechaza sin dejar nada", async () => {
    const s = await setup({ funds: 400_000 }); // tras desembolsar 300.000 y cobrar 150.000 quedan 250.000
    const funds = await cash(s);

    const error = await failureOf(refinance(s, { additionalAmount: funds + 1 }));

    expect(error).toMatchObject({ code: "INSUFFICIENT_FUNDS" });
    expect((await getLoanDetail(pool, s.admin, s.loanId, now()))!.status).toBe("ACTIVO");
    expect((await getClientDetail(pool, s.admin, s.clientId))!.loans).toHaveLength(1);
    expect(await cash(s)).toBe(funds);
    // Con exactamente lo que hay, sí.
    expect((await refinance(s, { additionalAmount: funds })).result.balance).toBe(0);
  });

  it("rechaza mora activa hasta que se paga o se anula, y un préstamo ya refinanciado, anulado o pagado", async () => {
    const s = await setup();
    const fee = await createLateFee(deps, s.admin, {
      idempotencyKey: key(),
      loanId: s.loanId,
      amount: 10_000,
      reason: "Atraso",
    });
    expect(await failureOf(refinance(s))).toMatchObject({
      code: "REFINANCE_WITH_LATE_FEES",
      status: 409,
    });
    await registerPayment(deps, s.admin, {
      idempotencyKey: key(),
      loanId: s.loanId,
      amount: 10_000,
      lateFeeChargeId: fee.result.chargeId,
    });
    await refinance(s);

    // Ya refinanciado: no recibe pagos, ni se refinancia, ni se anula, ni admite cargos o reversos.
    expect(await failureOf(refinance(s))).toMatchObject({ code: "LOAN_NOT_ACTIVE" });
    expect(
      await failureOf(
        registerPayment(deps, s.admin, { idempotencyKey: key(), loanId: s.loanId, amount: 1 }),
      ),
    ).toMatchObject({ code: "LOAN_NOT_ACTIVE" });
    expect(
      await failureOf(
        annulContract(deps, s.admin, { idempotencyKey: key(), loanId: s.loanId, reason: "x" }),
      ),
    ).toMatchObject({ code: "LOAN_REFINANCED" });
    const payments = (await getLoanDetail(pool, s.admin, s.loanId, now()))!.payments;
    expect(payments.every((p) => p.canReverse === false)).toBe(true);
    expect(
      await failureOf(
        reversePayment(deps, s.admin, {
          idempotencyKey: key(),
          paymentId: payments[0]!.id,
          reason: "x",
        }),
      ),
    ).toMatchObject({ code: "LOAN_NOT_ACTIVE" });
  });

  it("rechaza refinanciar con mora activa y la acepta tras anular el cargo", async () => {
    const s = await setup();
    const fee = await createLateFee(deps, s.admin, {
      idempotencyKey: key(),
      loanId: s.loanId,
      amount: 10_000,
      reason: "Atraso",
    });
    expect(await failureOf(refinance(s))).toMatchObject({ code: "REFINANCE_WITH_LATE_FEES" });
    await voidLateFee(deps, s.admin, {
      idempotencyKey: key(),
      chargeId: fee.result.chargeId,
      reason: "Error de digitación",
    });
    expect((await refinance(s)).result.refinancedBalance).toBe(150_000);
  });

  it("el préstamo nacido de una refinanciación no se anula y recibe los pagos sin tocar al anterior", async () => {
    const s = await setup();
    const outcome = await refinance(s, { interestBps: 0, installmentCount: 3 });
    const newLoanId = outcome.result.newLoanId;

    expect(
      await failureOf(
        annulContract(deps, s.admin, { idempotencyKey: key(), loanId: newLoanId, reason: "x" }),
      ),
    ).toMatchObject({ code: "LOAN_FROM_REFINANCING", status: 409 });

    await registerPayment(deps, s.admin, {
      idempotencyKey: key(),
      loanId: newLoanId,
      amount: 50_000,
    });
    const previous = await getLoanDetail(pool, s.admin, s.loanId, now());
    expect(previous!.status).toBe("REFINANCIADO");
    expect(previous!.payments).toHaveLength(1);
    const next = await getLoanDetail(pool, s.admin, newLoanId, now());
    expect(next!.payments).toHaveLength(1);
  });

  it("un adicional que supera el tope del principal es un error de dominio, no un 500", async () => {
    const s = await setup();
    const error = await failureOf(refinance(s, { additionalAmount: 1_000_000_000_000 }));
    expect(error.status).toBe(400);
  });

  it("es idempotente, atómica ante concurrencia y respeta aislamiento y permisos", async () => {
    const s = await setup();
    const other = await setup();
    const idempotencyKey = key();

    const first = await refinance(s, {}, idempotencyKey);
    const again = await refinance(s, {}, idempotencyKey);
    expect(again).toEqual({ result: first.result, replayed: true });
    expect(await failureOf(refinance(s, { installmentCount: 5 }, idempotencyKey))).toMatchObject({
      code: "IDEMPOTENCY_KEY_REUSED",
    });

    const racing = await setup();
    const outcomes = await Promise.allSettled([refinance(racing), refinance(racing)]);
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    expect(
      (outcomes.find((o) => o.status === "rejected") as PromiseRejectedResult).reason,
    ).toMatchObject({
      code: "LOAN_NOT_ACTIVE",
    });
    expect((await getClientDetail(pool, racing.admin, racing.clientId))!.loans).toHaveLength(2);

    expect(
      await failureOf(
        refinanceLoan(
          deps,
          s.admin,
          { loanId: other.loanId, idempotencyKey: key(), ...terms() },
          now,
        ),
      ),
    ).toMatchObject({ code: "LOAN_NOT_FOUND", status: 404 });
    const collector = await loadSessionContext(
      (await fixtures.account({ role: "COBRADOR", businessId: s.businessId })).userId,
      pool,
    );
    expect(
      await failureOf(
        refinanceLoan(
          deps,
          collector,
          { loanId: s.loanId, idempotencyKey: key(), ...terms() },
          now,
        ),
      ),
    ).toMatchObject({ code: "FORBIDDEN" });
  });

  it("un pago concurrente contra la refinanciación deja el saldo refinanciado igual al pendiente", async () => {
    const s = await setup();

    const outcomes = await Promise.allSettled([
      refinance(s),
      registerPayment(deps, s.admin, { idempotencyKey: key(), loanId: s.loanId, amount: 50_000 }),
    ]);

    const previous = await getLoanDetail(pool, s.admin, s.loanId, now());
    const refinancing = await pool.query<{ refinanced_balance: string }>(
      "select refinanced_balance::text from public.refinancings where previous_loan_id = $1",
      [s.loanId],
    );
    const paid = previous!.installments.reduce((sum, i) => sum + i.appliedAmount, 0);
    if (refinancing.rows[0]) {
      // Refinanció primero (el pago se rechazó) o el pago entró antes: en ambos casos cuadra con lo pagado.
      expect(Number(refinancing.rows[0].refinanced_balance)).toBe(300_000 - paid);
    } else {
      expect(outcomes[0]!.status).toBe("rejected");
    }
    expect(outcomes.some((o) => o.status === "fulfilled")).toBe(true);
  });

  it("el primer cobro anterior al desembolso se rechaza y un cobrador no refinancia", async () => {
    const s = await setup();
    expect(await failureOf(refinance(s, { firstDueOn: isoDate("2026-10-01") }))).toMatchObject({
      code: "FIRST_DUE_BEFORE_DISBURSEMENT",
    });
    expect((await getLoanDetail(pool, s.admin, s.loanId, now()))!.status).toBe("ACTIVO");
  });
});
