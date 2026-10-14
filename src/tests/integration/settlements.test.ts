import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { assignClient } from "@/modules/collections/assignments";
import { createCollector } from "@/modules/collections/collectors";
import { createRoute } from "@/modules/collections/routes";
import {
  openSession,
  registerCollectorExpense,
  transferFund,
} from "@/modules/collections/sessions";
import {
  confirmSettlement,
  declareSettlement,
  resolveDifference,
} from "@/modules/collections/settlements";
import { registerCapitalIncome } from "@/modules/cash/commands";
import { getCashSummary } from "@/modules/cash/queries";
import { loadSessionContext, type SessionContext } from "@/modules/identity/session";
import { createClient } from "@/modules/portfolio/clients";
import { confirmContract } from "@/modules/portfolio/contracts";
import { registerCollectorPayment, reversePayment } from "@/modules/portfolio/payments";
import { isoDate } from "@/shared/dates/dates";
import { AppError } from "@/shared/errors/app-error";
import type { IdempotencyKey } from "@/shared/ids/idempotency-key";
import { TEST_EMAIL_DOMAIN, TestFixtures, createAdminClient } from "./helpers/auth";
import { createTestPool } from "./helpers/db";

// F5-T6 (02 §5.2, §5.5; ADR 0009): declarar, confirmar y resolver la diferencia de una liquidación.

const pool = createTestPool();
const admin = createAdminClient();
const fixtures = new TestFixtures(pool, admin);
const deps = { db: pool };
const collectorDeps = { db: pool, admin, syntheticEmailDomain: TEST_EMAIL_DOMAIN };
const key = () => randomUUID() as IdempotencyKey;
const unique = () => randomUUID().slice(0, 8);
const now = () => new Date("2026-10-13T17:00:00Z");

afterAll(async () => {
  await fixtures.purge();
  await pool.end();
});

type World = Awaited<ReturnType<typeof world>>;

/** Jornada abierta con fondo de $100.000, un cobro de $80.000 y un gasto de $30.000: esperado $150.000. */
async function world() {
  const businessId = await fixtures.business("Liquidación");
  const account = await fixtures.account({ role: "ADMIN_NEGOCIO", businessId });
  const adminCtx: SessionContext = await loadSessionContext(account.userId, pool);
  await registerCapitalIncome(deps, adminCtx, { idempotencyKey: key(), amount: 2_000_000 });
  const created = await createCollector(collectorDeps, adminCtx, {
    name: "Carlos",
    username: `cob.${unique()}`,
  });
  fixtures.track({ userId: created.userId });
  await pool.query("update public.profiles set status = 'ACTIVO' where id = $1", [created.userId]);
  const collector = await loadSessionContext(created.userId, pool);
  const route = await createRoute(deps, adminCtx, {
    collectorId: created.collectorId,
    name: "Norte",
  });
  const client = await createClient(deps, adminCtx, { name: "Ana", identification: unique() });
  await assignClient(deps, adminCtx, { clientId: client.id, routeId: route.routeId });
  const loan = await confirmContract(
    deps,
    adminCtx,
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
  const sessionId = (await openSession(deps, collector, { idempotencyKey: key() }, now)).result
    .sessionId;
  await transferFund(deps, adminCtx, { idempotencyKey: key(), sessionId, amount: 100_000 });
  const paid = await registerCollectorPayment(deps, collector, {
    idempotencyKey: key(),
    loanId: loan.result.loanId,
    amount: 80_000,
  });
  await registerCollectorExpense(deps, collector, {
    idempotencyKey: key(),
    amount: 30_000,
    category: "GASOLINA",
  });
  return {
    businessId,
    admin: adminCtx,
    collector,
    sessionId,
    loanId: loan.result.loanId,
    paymentId: paid.result.paymentId,
  };
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

const declare = (w: World, declaredAmount: number) =>
  declareSettlement(deps, w.collector, { idempotencyKey: key(), declaredAmount });
const confirm = (w: World, settlementId: string, receivedAmount: number, observation?: string) =>
  confirmSettlement(deps, w.admin, {
    idempotencyKey: key(),
    settlementId,
    receivedAmount,
    observation,
  });
const sessionBalance = async (sessionId: string) =>
  Number(
    (
      await pool.query<{ n: string }>(
        `select coalesce(sum(case direction when 'ENTRADA' then amount else -amount end), 0)::text as n
           from public.cash_movements where session_id = $1`,
        [sessionId],
      )
    ).rows[0]!.n,
  );
const sessionStatus = async (sessionId: string) =>
  (
    await pool.query<{ status: string }>("select status from public.cash_sessions where id = $1", [
      sessionId,
    ])
  ).rows[0]!.status;

describe("declarar", () => {
  it("el cobrador declara: la jornada queda pendiente, no se mueve dinero y no se registra más", async () => {
    const w = await world();
    const mayorBefore = (await getCashSummary(pool, w.admin)).balance;

    const declared = await declare(w, 150_000);

    expect(declared.result).toMatchObject({ declaredAmount: 150_000, expectedAmount: 150_000 });
    expect(await sessionStatus(w.sessionId)).toBe("PENDIENTE_LIQUIDACION");
    expect((await getCashSummary(pool, w.admin)).balance).toBe(mayorBefore);
    expect(await sessionBalance(w.sessionId)).toBe(150_000);
    // Ya no hay jornada abierta: ni cobros, ni gastos, ni otra declaración, ni abrir otra jornada.
    expect(
      await failureOf(
        registerCollectorExpense(deps, w.collector, {
          idempotencyKey: key(),
          amount: 1,
          category: "GASOLINA",
        }),
      ),
    ).toMatchObject({ code: "NO_OPEN_SESSION" });
    expect(
      await failureOf(
        registerCollectorPayment(deps, w.collector, {
          idempotencyKey: key(),
          loanId: w.loanId,
          amount: 1,
        }),
      ),
    ).toMatchObject({ code: "NO_OPEN_SESSION" });
    expect(await failureOf(declare(w, 1))).toMatchObject({ code: "NO_OPEN_SESSION" });
    expect(
      await failureOf(openSession(deps, w.collector, { idempotencyKey: key() }, now)),
    ).toMatchObject({ code: "SESSION_ALREADY_OPEN" });
  });

  it("solo el cobrador declara y es idempotente", async () => {
    const w = await world();
    const idempotencyKey = key();
    const first = await declareSettlement(deps, w.collector, {
      idempotencyKey,
      declaredAmount: 10,
    });
    const again = await declareSettlement(deps, w.collector, {
      idempotencyKey,
      declaredAmount: 10,
    });
    expect(again.replayed).toBe(true);
    expect(again.result.settlementId).toBe(first.result.settlementId);

    const other = await world();
    expect(
      await failureOf(
        declareSettlement(deps, other.admin, { idempotencyKey: key(), declaredAmount: 0 }),
      ),
    ).toMatchObject({ status: 403 });
  });
});

describe("confirmar", () => {
  it("cuadrada: lo recibido entra a la Mayor, la jornada queda en cero y liquidada", async () => {
    const w = await world();
    const settlement = (await declare(w, 150_000)).result.settlementId;
    const mayorBefore = (await getCashSummary(pool, w.admin)).balance;

    const confirmed = await confirm(w, settlement, 150_000);

    expect(confirmed.result).toMatchObject({
      status: "CUADRADA",
      expectedAmount: 150_000,
      receivedAmount: 150_000,
      difference: 0,
      balance: mayorBefore + 150_000,
    });
    expect(await sessionBalance(w.sessionId)).toBe(0);
    expect(await sessionStatus(w.sessionId)).toBe("LIQUIDADA");
    expect((await getCashSummary(pool, w.admin)).balance).toBe(mayorBefore + 150_000);
    const actions = await pool.query<{ action: string }>(
      "select action from public.audit_events where business_id = $1 and action in ('LiquidacionDeclarada','LiquidacionConfirmada','DiferenciaRegistrada')",
      [w.businessId],
    );
    expect(actions.rows.map((r) => r.action).sort()).toEqual([
      "LiquidacionConfirmada",
      "LiquidacionDeclarada",
    ]);
  });

  it("con faltante: se registra la diferencia, exige observación y la jornada queda en cero", async () => {
    const w = await world();
    const settlement = (await declare(w, 120_000)).result.settlementId;
    const mayorBefore = (await getCashSummary(pool, w.admin)).balance;

    expect(await failureOf(confirm(w, settlement, 120_000))).toMatchObject({
      code: "OBSERVATION_REQUIRED",
      status: 400,
    });
    expect(await sessionStatus(w.sessionId)).toBe("PENDIENTE_LIQUIDACION");

    const confirmed = await confirm(w, settlement, 120_000, "Faltaron $30.000");
    expect(confirmed.result).toMatchObject({ status: "CON_DIFERENCIA", difference: 30_000 });
    expect(await sessionBalance(w.sessionId)).toBe(0);
    expect(await sessionStatus(w.sessionId)).toBe("LIQUIDADA_CON_DIFERENCIA");
    expect((await getCashSummary(pool, w.admin)).balance).toBe(mayorBefore + 120_000);
    const event = await pool.query<{ summary: { kind: string; amount: number } }>(
      "select summary from public.audit_events where business_id = $1 and action = 'DiferenciaRegistrada'",
      [w.businessId],
    );
    expect(event.rows[0]!.summary).toMatchObject({ kind: "FALTANTE", amount: 30_000 });
  });

  it("con sobrante: entra a la jornada y se entrega todo lo recibido", async () => {
    const w = await world();
    const settlement = (await declare(w, 170_000)).result.settlementId;
    const mayorBefore = (await getCashSummary(pool, w.admin)).balance;

    const confirmed = await confirm(w, settlement, 170_000, "El cliente pagó de más");

    expect(confirmed.result).toMatchObject({ status: "CON_DIFERENCIA", difference: -20_000 });
    expect(await sessionBalance(w.sessionId)).toBe(0);
    expect((await getCashSummary(pool, w.admin)).balance).toBe(mayorBefore + 170_000);
  });

  it("sin dinero entregado (cero) también cierra, con diferencia", async () => {
    const w = await world();
    const settlement = (await declare(w, 0)).result.settlementId;
    const mayorBefore = (await getCashSummary(pool, w.admin)).balance;

    const confirmed = await confirm(w, settlement, 0, "No entregó nada");

    expect(confirmed.result).toMatchObject({ difference: 150_000, receivedAmount: 0 });
    expect(await sessionBalance(w.sessionId)).toBe(0);
    expect((await getCashSummary(pool, w.admin)).balance).toBe(mayorBefore);
  });

  it("es idempotente, atómica y solo la confirma el Admin de su negocio", async () => {
    const w = await world();
    const other = await world();
    const settlement = (await declare(w, 150_000)).result.settlementId;
    const idempotencyKey = key();

    const first = await confirmSettlement(deps, w.admin, {
      idempotencyKey,
      settlementId: settlement,
      receivedAmount: 150_000,
    });
    const again = await confirmSettlement(deps, w.admin, {
      idempotencyKey,
      settlementId: settlement,
      receivedAmount: 150_000,
    });
    expect(again.replayed).toBe(true);
    expect(again.result).toEqual(first.result);
    expect(await failureOf(confirm(w, settlement, 150_000))).toMatchObject({
      code: "SETTLEMENT_ALREADY_CONFIRMED",
    });

    const otherSettlement = (await declare(other, 150_000)).result.settlementId;
    expect(await failureOf(confirm(w, otherSettlement, 150_000))).toMatchObject({
      code: "SETTLEMENT_NOT_FOUND",
      status: 404,
    });
    expect(
      await failureOf(
        confirmSettlement(deps, other.collector, {
          idempotencyKey: key(),
          settlementId: otherSettlement,
          receivedAmount: 150_000,
        }),
      ),
    ).toMatchObject({ status: 403 });
    expect(await sessionStatus(other.sessionId)).toBe("PENDIENTE_LIQUIDACION");
  });

  it("antes de liquidar, el Admin reversa un cobro de la jornada y cambia lo esperado", async () => {
    const w = await world();
    const settlement = (await declare(w, 70_000)).result.settlementId;

    await reversePayment(deps, w.admin, {
      idempotencyKey: key(),
      paymentId: w.paymentId,
      reason: "Error",
    });

    // Esperado: 100.000 + 80.000 − 30.000 − 80.000 = 70.000.
    const confirmed = await confirm(w, settlement, 70_000);
    expect(confirmed.result).toMatchObject({ expectedAmount: 70_000, status: "CUADRADA" });
  });

  it("un cobro de una jornada ya liquidada se corrige con un reverso de la Mayor, sin cambiar la jornada", async () => {
    const w = await world();
    const settlement = (await declare(w, 150_000)).result.settlementId;
    await confirm(w, settlement, 150_000);
    const mayorBefore = (await getCashSummary(pool, w.admin)).balance;

    const reversed = await reversePayment(deps, w.admin, {
      idempotencyKey: key(),
      paymentId: w.paymentId,
      reason: "El cliente no pagó",
    });

    expect(reversed.result.loanPendingBalance).toBe(300_000);
    expect((await getCashSummary(pool, w.admin)).balance).toBe(mayorBefore - 80_000);
    expect(await sessionBalance(w.sessionId)).toBe(0);
    expect(await sessionStatus(w.sessionId)).toBe("LIQUIDADA");
  });
});

describe("resolver la diferencia", () => {
  it("un faltante repuesto entra a la Mayor con un AJUSTE, una sola vez; la liquidación no cambia", async () => {
    const w = await world();
    const settlement = (await declare(w, 120_000)).result.settlementId;
    await confirm(w, settlement, 120_000, "Faltaron 30.000");
    const mayorBefore = (await getCashSummary(pool, w.admin)).balance;

    const resolved = await resolveDifference(deps, w.admin, {
      idempotencyKey: key(),
      settlementId: settlement,
      note: "El cobrador repuso el faltante",
    });

    expect(resolved.result).toMatchObject({ amount: 30_000, direction: "ENTRADA" });
    expect((await getCashSummary(pool, w.admin)).balance).toBe(mayorBefore + 30_000);
    const row = await pool.query(
      "select status, difference::int from public.settlements where id = $1",
      [settlement],
    );
    expect(row.rows[0]).toEqual({ status: "CON_DIFERENCIA", difference: 30_000 });
    expect(
      await failureOf(
        resolveDifference(deps, w.admin, {
          idempotencyKey: key(),
          settlementId: settlement,
          note: "otra",
        }),
      ),
    ).toMatchObject({ code: "DIFFERENCE_ALREADY_RESOLVED" });
  });

  it("un sobrante devuelto sale de la Mayor y una liquidación cuadrada o pendiente no se resuelve", async () => {
    const w = await world();
    const settlement = (await declare(w, 170_000)).result.settlementId;
    expect(
      await failureOf(
        resolveDifference(deps, w.admin, {
          idempotencyKey: key(),
          settlementId: settlement,
          note: "x",
        }),
      ),
    ).toMatchObject({ code: "SETTLEMENT_WITHOUT_DIFFERENCE" });
    await confirm(w, settlement, 170_000, "Sobraron 20.000");
    const mayorBefore = (await getCashSummary(pool, w.admin)).balance;

    const resolved = await resolveDifference(deps, w.admin, {
      idempotencyKey: key(),
      settlementId: settlement,
      note: "Se devolvió al cliente",
    });
    expect(resolved.result).toMatchObject({ amount: 20_000, direction: "SALIDA" });
    expect((await getCashSummary(pool, w.admin)).balance).toBe(mayorBefore - 20_000);

    const cuadrada = await world();
    const exact = (await declare(cuadrada, 150_000)).result.settlementId;
    await confirm(cuadrada, exact, 150_000);
    expect(
      await failureOf(
        resolveDifference(deps, cuadrada.admin, {
          idempotencyKey: key(),
          settlementId: exact,
          note: "x",
        }),
      ),
    ).toMatchObject({ code: "SETTLEMENT_WITHOUT_DIFFERENCE" });
  });
});

describe("jornadas sucesivas", () => {
  it("liquidada la jornada, el cobrador abre otra, en cero, y la anterior no se toca", async () => {
    const w = await world();
    const settlement = (await declare(w, 150_000)).result.settlementId;
    await confirm(w, settlement, 150_000);

    const next = await openSession(deps, w.collector, { idempotencyKey: key() }, now);

    expect(next.result.sessionId).not.toBe(w.sessionId);
    expect(await sessionBalance(next.result.sessionId)).toBe(0);
    expect(await sessionStatus(w.sessionId)).toBe("LIQUIDADA");
  });
});
