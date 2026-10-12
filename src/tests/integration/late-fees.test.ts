import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { registerCapitalIncome } from "@/modules/cash/commands";
import { getCashSummary } from "@/modules/cash/queries";
import { loadSessionContext, type SessionContext } from "@/modules/identity/session";
import { createClient } from "@/modules/portfolio/clients";
import { annulContract, confirmContract } from "@/modules/portfolio/contracts";
import { createLateFee, voidLateFee } from "@/modules/portfolio/late-fees";
import { getLoanDetail } from "@/modules/portfolio/loan-queries";
import { registerPayment, reversePayment } from "@/modules/portfolio/payments";
import { isoDate } from "@/shared/dates/dates";
import { AppError } from "@/shared/errors/app-error";
import type { IdempotencyKey } from "@/shared/ids/idempotency-key";
import { TestFixtures, createAdminClient } from "./helpers/auth";
import { createTestPool } from "./helpers/db";

// F4-T4 (02 §3.3–3.4, ADR 0008): la mora de una cuota es un cálculo derivado sin dinero; el cargo de mora
// lo crea el Admin a mano, se paga con un pago explícito contra el cargo y se anula con motivo.

const pool = createTestPool();
const fixtures = new TestFixtures(pool, createAdminClient());
const deps = { db: pool };

afterAll(async () => {
  await fixtures.purge();
  await pool.end();
});

const key = () => randomUUID() as IdempotencyKey;
const now = () => new Date("2026-10-13T17:00:00Z");

type Setup = Awaited<ReturnType<typeof setup>>;

/** Préstamo de $300.000 sin interés en 3 cuotas de $100.000 (14, 15 y 16 de octubre). */
async function setup() {
  const businessId = await fixtures.business("Mora");
  const account = await fixtures.account({ role: "ADMIN_NEGOCIO", businessId });
  const admin: SessionContext = await loadSessionContext(account.userId, pool);
  const client = await createClient(deps, admin, {
    name: "Ana",
    identification: randomUUID().slice(0, 8),
  });
  await registerCapitalIncome(deps, admin, { idempotencyKey: key(), amount: 2_000_000 });
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
  const installments = (
    await pool.query<{ id: string }>(
      "select id from public.installments where loan_id = $1 order by number",
      [loan.result.loanId],
    )
  ).rows.map((row) => row.id);
  return { businessId, admin, loanId: loan.result.loanId, installments };
}

const fee = (
  s: Setup,
  amount = 20_000,
  extra: Partial<{ installmentId: string; reason: string; idempotencyKey: IdempotencyKey }> = {},
) =>
  createLateFee(deps, s.admin, {
    idempotencyKey: extra.idempotencyKey ?? key(),
    loanId: s.loanId,
    installmentId: extra.installmentId,
    amount,
    reason: extra.reason ?? "Cuota atrasada",
  });

const pay = (s: Setup, amount: number, lateFeeChargeId?: string) =>
  registerPayment(deps, s.admin, {
    idempotencyKey: key(),
    loanId: s.loanId,
    amount,
    lateFeeChargeId,
  });

const detail = (s: Setup, at = now()) => getLoanDetail(pool, s.admin, s.loanId, at);

async function failureOf(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("se esperaba un AppError");
}

describe("la mora derivada nunca genera dinero", () => {
  it("con cuotas vencidas hay días de mora, pero ningún cargo, pago ni movimiento se crea solo", async () => {
    const s = await setup();
    const funds = (await getCashSummary(pool, s.admin)).balance;

    const later = new Date("2026-10-30T17:00:00Z");
    const loan = await detail(s, later);

    expect(loan!.installments.every((i) => i.status === "VENCIDA" && i.daysLate > 0)).toBe(true);
    expect(loan!.lateFees).toEqual([]);
    expect(loan!.payments).toEqual([]);
    expect((await getCashSummary(pool, s.admin)).balance).toBe(funds);
  });
});

describe("crear un cargo de mora", () => {
  it("lo crea el Admin con motivo, sobre una cuota o el préstamo, y no mueve la caja", async () => {
    const s = await setup();
    const funds = (await getCashSummary(pool, s.admin)).balance;

    const onInstallment = await fee(s, 20_000, { installmentId: s.installments[0]! });
    const onLoan = await fee(s, 5_000, { reason: "Cobro de gestión" });

    expect(onInstallment.result).toMatchObject({ installmentNumber: 1, amount: 20_000 });
    expect(onLoan.result.installmentNumber).toBeNull();
    const loan = await detail(s);
    expect(
      loan!.lateFees.map((f) => [f.amount, f.pendingAmount, f.status, f.installmentNumber]),
    ).toEqual([
      [20_000, 20_000, "ACTIVO", 1],
      [5_000, 5_000, "ACTIVO", null],
    ]);
    expect(loan!.lateFeeBalance).toBe(25_000);
    expect((await getCashSummary(pool, s.admin)).balance).toBe(funds);
    // Las cuotas no cambian: el cargo es una entidad aparte.
    expect(loan!.installments.map((i) => i.amount)).toEqual([100_000, 100_000, 100_000]);
    const audit = await pool.query<{ summary: { reason: string; amount: number } }>(
      "select summary from public.audit_events where business_id = $1 and action = 'CargoMoraCreado' order by occurred_at",
      [s.businessId],
    );
    expect(audit.rows.map((r) => r.summary.reason)).toEqual(["Cuota atrasada", "Cobro de gestión"]);
  });

  it("es idempotente, rechaza una cuota de otro préstamo y un préstamo ajeno o anulado", async () => {
    const s = await setup();
    const other = await setup();
    const idempotencyKey = key();

    const first = await fee(s, 20_000, { idempotencyKey });
    const again = await fee(s, 20_000, { idempotencyKey });
    expect(again).toEqual({ result: first.result, replayed: true });
    expect(await failureOf(fee(s, 21_000, { idempotencyKey }))).toMatchObject({
      code: "IDEMPOTENCY_KEY_REUSED",
    });
    expect((await detail(s))!.lateFees).toHaveLength(1);

    expect(await failureOf(fee(s, 1_000, { installmentId: other.installments[0]! }))).toMatchObject(
      {
        code: "INSTALLMENT_NOT_FOUND",
        status: 404,
      },
    );
    expect(
      await failureOf(
        createLateFee(deps, s.admin, {
          idempotencyKey: key(),
          loanId: other.loanId,
          amount: 1_000,
          reason: "x",
        }),
      ),
    ).toMatchObject({ code: "LOAN_NOT_FOUND", status: 404 });
  });

  it("un cobrador recibe 403 con RECHAZADO y no crea nada", async () => {
    const s = await setup();
    const collector = await loadSessionContext(
      (await fixtures.account({ role: "COBRADOR", businessId: s.businessId })).userId,
      pool,
    );

    expect(
      await failureOf(
        createLateFee(deps, collector, {
          idempotencyKey: key(),
          loanId: s.loanId,
          amount: 1_000,
          reason: "x",
        }),
      ),
    ).toMatchObject({ code: "FORBIDDEN" });
    expect((await detail(s))!.lateFees).toEqual([]);
    const rejected = await pool.query(
      "select 1 from public.audit_events where business_id = $1 and action = 'CrearCargoMora' and result = 'RECHAZADO'",
      [s.businessId],
    );
    expect(rejected.rowCount).toBe(1);
  });
});

describe("pagar un cargo de mora", () => {
  it("se paga con un pago explícito contra el cargo, con su propio tope, y entra a la caja", async () => {
    const s = await setup();
    const charge = await fee(s, 20_000);
    const funds = (await getCashSummary(pool, s.admin)).balance;

    const partial = await pay(s, 8_000, charge.result.chargeId);

    expect(partial.result).toMatchObject({
      kind: "CARGO_MORA",
      applications: [{ installmentNumber: null, applied: 8_000, pendingAfter: 12_000 }],
      loanPendingBalance: 300_000,
    });
    expect((await getCashSummary(pool, s.admin)).balance).toBe(funds + 8_000);
    expect(await failureOf(pay(s, 12_001, charge.result.chargeId))).toMatchObject({
      code: "PAYMENT_EXCEEDS_BALANCE",
    });

    await pay(s, 12_000, charge.result.chargeId);
    expect(await failureOf(pay(s, 1, charge.result.chargeId))).toMatchObject({
      code: "LATE_FEE_PAID",
    });
    const loan = await detail(s);
    expect(loan!.lateFees[0]).toMatchObject({
      status: "PAGADO",
      pendingAmount: 0,
      appliedAmount: 20_000,
    });
    // Un pago de cuotas sigue sin poder cubrir un cargo: el tope de cuotas no incluye mora.
    expect(await failureOf(pay(s, 300_001))).toMatchObject({ code: "PAYMENT_EXCEEDS_BALANCE" });
  });

  it("el préstamo solo está PAGADO con cuotas y cargos activos en cero; el último pago emite PrestamoPagado", async () => {
    const s = await setup();
    const charge = await fee(s, 20_000);

    const cuotas = await pay(s, 300_000);
    expect(cuotas.result).toMatchObject({ loanPendingBalance: 0, loanPaid: false });
    expect((await detail(s))!.status).toBe("ACTIVO");

    const last = await pay(s, 20_000, charge.result.chargeId);
    expect(last.result.loanPaid).toBe(true);
    expect((await detail(s))!.status).toBe("PAGADO");

    const events = await pool.query<{ action: string }>(
      "select action from public.audit_events where business_id = $1 and action in ('PrestamoPagado','CargoMoraPagado')",
      [s.businessId],
    );
    expect(events.rows.map((e) => e.action).sort()).toEqual(["CargoMoraPagado", "PrestamoPagado"]);
  });

  it("un cargo anulado o de otro préstamo no se paga", async () => {
    const s = await setup();
    const other = await setup();
    const charge = await fee(s, 20_000);
    const foreign = await fee(other, 20_000);

    expect(
      await failureOf(
        registerPayment(deps, s.admin, {
          idempotencyKey: key(),
          loanId: s.loanId,
          amount: 10,
          lateFeeChargeId: foreign.result.chargeId,
        }),
      ),
    ).toMatchObject({ code: "LATE_FEE_NOT_FOUND" });
    await voidLateFee(deps, s.admin, {
      idempotencyKey: key(),
      chargeId: charge.result.chargeId,
      reason: "Error",
    });
    expect(await failureOf(pay(s, 10, charge.result.chargeId))).toMatchObject({
      code: "LATE_FEE_VOIDED",
    });
  });
});

describe("anular un cargo de mora", () => {
  it("exige motivo, deja el cargo en el historial y deja de contar en el saldo", async () => {
    const s = await setup();
    const charge = await fee(s, 20_000);

    const voided = await voidLateFee(deps, s.admin, {
      idempotencyKey: key(),
      chargeId: charge.result.chargeId,
      reason: "Lo cobró por error",
    });

    expect(voided.result).toMatchObject({ chargeId: charge.result.chargeId, amount: 20_000 });
    const loan = await detail(s);
    expect(loan!.lateFees[0]).toMatchObject({
      status: "ANULADO",
      pendingAmount: 0,
      voidReason: "Lo cobró por error",
    });
    expect(loan!.lateFeeBalance).toBe(0);
    expect(
      await failureOf(
        voidLateFee(deps, s.admin, {
          idempotencyKey: key(),
          chargeId: charge.result.chargeId,
          reason: "x",
        }),
      ),
    ).toMatchObject({
      code: "LATE_FEE_VOIDED",
    });
    const audit = await pool.query<{ summary: { reason: string } }>(
      "select summary from public.audit_events where business_id = $1 and action = 'CargoMoraAnulado'",
      [s.businessId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]!.summary.reason).toBe("Lo cobró por error");
  });

  it("con pagos vigentes no se anula: se reversan primero (y entonces sí)", async () => {
    const s = await setup();
    const charge = await fee(s, 20_000);
    const paid = await pay(s, 5_000, charge.result.chargeId);

    expect(
      await failureOf(
        voidLateFee(deps, s.admin, {
          idempotencyKey: key(),
          chargeId: charge.result.chargeId,
          reason: "x",
        }),
      ),
    ).toMatchObject({ code: "LATE_FEE_HAS_PAYMENTS", status: 409 });

    await reversePayment(deps, s.admin, {
      idempotencyKey: key(),
      paymentId: paid.result.paymentId,
      reason: "x",
    });
    expect(
      (
        await voidLateFee(deps, s.admin, {
          idempotencyKey: key(),
          chargeId: charge.result.chargeId,
          reason: "x",
        })
      ).replayed,
    ).toBe(false);
  });

  it("un cargo ajeno es «no encontrado»; un cobrador recibe 403; dos anulaciones simultáneas: una se aplica", async () => {
    const s = await setup();
    const other = await setup();
    const foreign = await fee(other, 1_000);
    const charge = await fee(s, 20_000);
    const collector = await loadSessionContext(
      (await fixtures.account({ role: "COBRADOR", businessId: s.businessId })).userId,
      pool,
    );

    expect(
      await failureOf(
        voidLateFee(deps, s.admin, {
          idempotencyKey: key(),
          chargeId: foreign.result.chargeId,
          reason: "x",
        }),
      ),
    ).toMatchObject({ code: "LATE_FEE_NOT_FOUND", status: 404 });
    expect(
      await failureOf(
        voidLateFee(deps, collector, {
          idempotencyKey: key(),
          chargeId: charge.result.chargeId,
          reason: "x",
        }),
      ),
    ).toMatchObject({ code: "FORBIDDEN" });

    const outcomes = await Promise.allSettled(
      [1, 2].map(() =>
        voidLateFee(deps, s.admin, {
          idempotencyKey: key(),
          chargeId: charge.result.chargeId,
          reason: "x",
        }),
      ),
    );
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    expect(
      (outcomes.find((o) => o.status === "rejected") as PromiseRejectedResult).reason,
    ).toMatchObject({
      code: "LATE_FEE_VOIDED",
    });
  });
});

describe("barreras adicionales de los cargos de mora", () => {
  it("anular es idempotente, no mueve la caja y un pago simultáneo contra la anulación deja un estado consistente", async () => {
    const s = await setup();
    const funds = (await getCashSummary(pool, s.admin)).balance;
    const charge = await fee(s, 20_000);
    const idempotencyKey = key();
    const input = { idempotencyKey, chargeId: charge.result.chargeId, reason: "Error" };

    const first = await voidLateFee(deps, s.admin, input);
    const again = await voidLateFee(deps, s.admin, input);

    expect(again).toEqual({ result: first.result, replayed: true });
    expect(await failureOf(voidLateFee(deps, s.admin, { ...input, reason: "Otro" }))).toMatchObject(
      {
        code: "IDEMPOTENCY_KEY_REUSED",
      },
    );
    expect((await getCashSummary(pool, s.admin)).balance).toBe(funds);

    const racing = await fee(s, 10_000);
    const outcomes = await Promise.allSettled([
      voidLateFee(deps, s.admin, {
        idempotencyKey: key(),
        chargeId: racing.result.chargeId,
        reason: "x",
      }),
      pay(s, 4_000, racing.result.chargeId),
    ]);
    const [voided, paid] = outcomes;
    // O se anuló primero (y el pago falla por anulado) o se pagó primero (y la anulación se rechaza).
    expect(voided!.status === "fulfilled" || paid!.status === "fulfilled").toBe(true);
    expect(voided!.status === "fulfilled" && paid!.status === "fulfilled").toBe(false);
    const loan = await detail(s);
    const row = loan!.lateFees.find((f) => f.id === racing.result.chargeId)!;
    expect(row.status === "ANULADO" ? row.appliedAmount === 0 : row.appliedAmount === 4_000).toBe(
      true,
    );
    if (voided!.status === "rejected") {
      expect((voided as PromiseRejectedResult).reason).toMatchObject({
        code: "LATE_FEE_HAS_PAYMENTS",
      });
    } else {
      expect((paid as PromiseRejectedResult).reason).toMatchObject({ code: "LATE_FEE_VOIDED" });
    }
  });

  it("no se crean cargos ni se pagan sobre un préstamo anulado", async () => {
    const s = await setup();
    await annulContract(deps, s.admin, {
      idempotencyKey: key(),
      loanId: s.loanId,
      reason: "Error",
    });

    expect(await failureOf(fee(s, 1_000))).toMatchObject({ code: "LOAN_NOT_ACTIVE" });
  });
});
