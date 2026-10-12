import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import {
  registerAdjustment,
  registerCapitalIncome,
  registerMainCashboxExpense,
  registerOpeningBalance,
  reverseMovement,
} from "@/modules/cash/commands";
import { getCashSummary } from "@/modules/cash/queries";
import { loadSessionContext, type SessionContext } from "@/modules/identity/session";
import { AppError } from "@/shared/errors/app-error";
import type { IdempotencyKey } from "@/shared/ids/idempotency-key";
import { TestFixtures, createAdminClient } from "./helpers/auth";
import { createTestPool } from "./helpers/db";

// F2-T3 (ADR 0006, 02 §5): saldo de apertura, ingreso de capital, gasto de Caja Mayor, ajuste y
// reverso. Cada comando deja su movimiento, su auditoría y un saldo derivado coherente.

const pool = createTestPool();
const fixtures = new TestFixtures(pool, createAdminClient());
const deps = { db: pool };

afterAll(async () => {
  await fixtures.purge();
  await pool.end();
});

const key = () => randomUUID() as IdempotencyKey;

async function newBusiness(): Promise<{ businessId: string; admin: SessionContext }> {
  const businessId = await fixtures.business("Caja comandos");
  const account = await fixtures.account({ role: "ADMIN_NEGOCIO", businessId });
  return { businessId, admin: await loadSessionContext(account.userId, pool) };
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

const audit = async (businessId: string, action: string) =>
  (
    await pool.query<{ entity_type: string; result: string; summary: Record<string, unknown> }>(
      "select entity_type, result, summary from public.audit_events where business_id = $1 and action = $2",
      [businessId, action],
    )
  ).rows;

const movements = async (businessId: string) =>
  (
    await pool.query<{ type: string; direction: string; amount: string; note: string | null }>(
      "select type, direction, amount::text, note from public.cash_movements where business_id = $1 order by created_at, id",
      [businessId],
    )
  ).rows;

describe("saldo de apertura e ingreso de capital", () => {
  it("la apertura entra a la caja, se audita y no admite una segunda", async () => {
    const { businessId, admin } = await newBusiness();

    const first = await registerOpeningBalance(deps, admin, {
      idempotencyKey: key(),
      amount: 500_000,
      note: "Efectivo inicial",
    });

    expect(first.result.balance).toBe(500_000);
    expect(await movements(businessId)).toEqual([
      { type: "SALDO_APERTURA", direction: "ENTRADA", amount: "500000", note: "Efectivo inicial" },
    ]);
    expect(await audit(businessId, "SaldoAperturaRegistrado")).toEqual([
      { entity_type: "cash_movement", result: "OK", summary: { amount: 500_000 } },
    ]);

    const second = await failureOf(
      registerOpeningBalance(deps, admin, { idempotencyKey: key(), amount: 1 }),
    );
    expect(second).toMatchObject({ code: "OPENING_BALANCE_EXISTS", status: 409 });
    expect(await movements(businessId)).toHaveLength(1);
  });

  it("el ingreso de capital suma al saldo y reenviarlo con la misma clave no lo duplica", async () => {
    const { businessId, admin } = await newBusiness();
    await registerOpeningBalance(deps, admin, { idempotencyKey: key(), amount: 1000 });
    const idempotencyKey = key();

    const first = await registerCapitalIncome(deps, admin, { idempotencyKey, amount: 250 });
    const again = await registerCapitalIncome(deps, admin, { idempotencyKey, amount: 250 });

    expect(first.result.balance).toBe(1250);
    expect(again).toEqual({ result: first.result, replayed: true });
    expect((await getCashSummary(pool, admin)).balance).toBe(1250);
    expect(await audit(businessId, "CapitalIngresado")).toHaveLength(1);
  });
});

describe("gasto de Caja Mayor", () => {
  it("reduce la caja, crea el gasto con su categoría y la fecha de hoy del negocio, y audita", async () => {
    const { businessId, admin } = await newBusiness();
    await registerOpeningBalance(deps, admin, { idempotencyKey: key(), amount: 100_000 });
    // 2026-03-01 02:00 UTC es todavía el 28/02 en Bogotá (UTC-5): la fecha es la del negocio.
    const now = () => new Date("2026-03-01T02:00:00Z");

    const result = await registerMainCashboxExpense(
      deps,
      admin,
      { idempotencyKey: key(), amount: 30_000, category: "REPARACION", note: "Cerradura" },
      now,
    );

    expect(result.result.balance).toBe(70_000);
    const expense = await pool.query(
      `select category, amount::text, spent_on::text, note, movement_id
         from public.expenses where id = $1`,
      [result.result.expenseId],
    );
    expect(expense.rows[0]).toEqual({
      category: "REPARACION",
      amount: "30000",
      spent_on: "2026-02-28",
      note: "Cerradura",
      movement_id: result.result.movementId,
    });
    expect((await movements(businessId)).at(-1)).toMatchObject({
      type: "GASTO_CAJA_MAYOR",
      direction: "SALIDA",
      amount: "30000",
    });
    expect(await audit(businessId, "GastoRegistrado")).toHaveLength(1);
  });

  it("un gasto mayor al saldo se rechaza (409) sin dejar movimiento, gasto ni auditoría", async () => {
    const { businessId, admin } = await newBusiness();
    await registerOpeningBalance(deps, admin, { idempotencyKey: key(), amount: 1000 });

    const error = await failureOf(
      registerMainCashboxExpense(deps, admin, {
        idempotencyKey: key(),
        amount: 1001,
        category: "GASOLINA",
      }),
    );

    expect(error).toMatchObject({ code: "INSUFFICIENT_FUNDS", status: 409 });
    expect(await movements(businessId)).toHaveLength(1);
    expect(await audit(businessId, "GastoRegistrado")).toEqual([]);
    const expenses = await pool.query("select 1 from public.expenses where business_id = $1", [
      businessId,
    ]);
    expect(expenses.rowCount).toBe(0);
  });

  it("gastar exactamente todo el saldo es válido y deja la caja en cero", async () => {
    const { admin } = await newBusiness();
    await registerCapitalIncome(deps, admin, { idempotencyKey: key(), amount: 777 });

    const result = await registerMainCashboxExpense(deps, admin, {
      idempotencyKey: key(),
      amount: 777,
      category: "OTRO",
      note: "Todo",
    });

    expect(result.result.balance).toBe(0);
  });
});

describe("ajuste", () => {
  it("suma o resta con motivo y nunca deja el saldo negativo", async () => {
    const { businessId, admin } = await newBusiness();
    await registerCapitalIncome(deps, admin, { idempotencyKey: key(), amount: 1000 });

    const up = await registerAdjustment(deps, admin, {
      idempotencyKey: key(),
      direction: "ENTRADA",
      amount: 200,
      reason: "Faltaba un billete",
    });
    const down = await registerAdjustment(deps, admin, {
      idempotencyKey: key(),
      direction: "SALIDA",
      amount: 500,
      reason: "Error de conteo",
    });
    const tooMuch = await failureOf(
      registerAdjustment(deps, admin, {
        idempotencyKey: key(),
        direction: "SALIDA",
        amount: 701,
        reason: "Demasiado",
      }),
    );

    expect(up.result.balance).toBe(1200);
    expect(down.result.balance).toBe(700);
    expect(tooMuch).toMatchObject({ code: "INSUFFICIENT_FUNDS" });
    expect(await audit(businessId, "AjusteRegistrado")).toHaveLength(2);
  });
});

describe("reverso", () => {
  it("anula por completo un movimiento, una sola vez, y deja ambos en el historial", async () => {
    const { businessId, admin } = await newBusiness();
    const income = await registerCapitalIncome(deps, admin, { idempotencyKey: key(), amount: 900 });

    const reversal = await reverseMovement(deps, admin, {
      idempotencyKey: key(),
      movementId: income.result.movementId,
      reason: "Se registró dos veces",
    });

    expect(reversal.result.balance).toBe(0);
    expect(await movements(businessId)).toEqual([
      expect.objectContaining({ type: "INGRESO_CAPITAL", direction: "ENTRADA", amount: "900" }),
      expect.objectContaining({ type: "REVERSO", direction: "SALIDA", amount: "900" }),
    ]);
    const twice = await failureOf(
      reverseMovement(deps, admin, {
        idempotencyKey: key(),
        movementId: income.result.movementId,
        reason: "Otra vez",
      }),
    );
    expect(twice).toMatchObject({ code: "MOVEMENT_ALREADY_REVERSED", status: 409 });

    const summary = await getCashSummary(pool, admin);
    const original = summary.movements.find((m) => m.id === income.result.movementId);
    expect(original?.reversedByMovementId).toBe(reversal.result.movementId);
    const reverso = summary.movements.find((m) => m.id === reversal.result.movementId);
    expect(reverso?.reversesMovementId).toBe(income.result.movementId);
  });

  it("reversar un gasto devuelve el dinero; un reverso no se reversa", async () => {
    const { admin } = await newBusiness();
    await registerCapitalIncome(deps, admin, { idempotencyKey: key(), amount: 1000 });
    const expense = await registerMainCashboxExpense(deps, admin, {
      idempotencyKey: key(),
      amount: 400,
      category: "MEDICINA",
    });

    const back = await reverseMovement(deps, admin, {
      idempotencyKey: key(),
      movementId: expense.result.movementId,
      reason: "Gasto duplicado",
    });
    expect(back.result.balance).toBe(1000);

    const reverseTheReversal = await failureOf(
      reverseMovement(deps, admin, {
        idempotencyKey: key(),
        movementId: back.result.movementId,
        reason: "No",
      }),
    );
    expect(reverseTheReversal).toMatchObject({ code: "MOVEMENT_NOT_REVERSIBLE" });
  });

  it("reversar un ingreso ya gastado se rechaza por saldo insuficiente", async () => {
    const { businessId, admin } = await newBusiness();
    const income = await registerCapitalIncome(deps, admin, {
      idempotencyKey: key(),
      amount: 1000,
    });
    await registerMainCashboxExpense(deps, admin, {
      idempotencyKey: key(),
      amount: 600,
      category: "GASOLINA",
    });

    const error = await failureOf(
      reverseMovement(deps, admin, {
        idempotencyKey: key(),
        movementId: income.result.movementId,
        reason: "Error",
      }),
    );

    expect(error).toMatchObject({ code: "INSUFFICIENT_FUNDS" });
    expect(await audit(businessId, "ReversoRegistrado")).toEqual([]);
  });

  it("un movimiento de otro negocio es «no encontrado» (aislamiento)", async () => {
    const mine = await newBusiness();
    const other = await newBusiness();
    const foreign = await registerCapitalIncome(deps, other.admin, {
      idempotencyKey: key(),
      amount: 500,
    });

    const error = await failureOf(
      reverseMovement(deps, mine.admin, {
        idempotencyKey: key(),
        movementId: foreign.result.movementId,
        reason: "Intento",
      }),
    );

    expect(error).toMatchObject({ code: "MOVEMENT_NOT_FOUND", status: 404 });
    expect((await getCashSummary(pool, other.admin)).balance).toBe(500);
  });
});

describe("consulta de la caja", () => {
  it("el saldo es la suma derivada de los movimientos, con la apertura indicada y el historial reciente primero", async () => {
    const { admin } = await newBusiness();
    expect(await getCashSummary(pool, admin)).toMatchObject({
      balance: 0,
      hasOpeningBalance: false,
      movements: [],
      truncated: false,
    });

    await registerOpeningBalance(deps, admin, { idempotencyKey: key(), amount: 300 });
    await registerCapitalIncome(deps, admin, { idempotencyKey: key(), amount: 200 });
    await registerMainCashboxExpense(deps, admin, {
      idempotencyKey: key(),
      amount: 50,
      category: "ALIMENTACION",
    });

    const summary = await getCashSummary(pool, admin);
    expect(summary.balance).toBe(450);
    expect(summary.hasOpeningBalance).toBe(true);
    expect(summary.movements.map((m) => m.type)).toEqual([
      "GASTO_CAJA_MAYOR",
      "INGRESO_CAPITAL",
      "SALDO_APERTURA",
    ]);
    expect(summary.movements[0]).toMatchObject({ category: "ALIMENTACION", amount: 50 });
  });

  it("solo el Admin la consulta, y cada negocio ve solo la suya", async () => {
    const one = await newBusiness();
    const two = await newBusiness();
    await registerCapitalIncome(deps, one.admin, { idempotencyKey: key(), amount: 111 });
    const collector = await loadSessionContext(
      (await fixtures.account({ role: "COBRADOR", businessId: one.businessId })).userId,
      pool,
    );

    expect((await getCashSummary(pool, two.admin)).balance).toBe(0);
    await expect(getCashSummary(pool, collector)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
