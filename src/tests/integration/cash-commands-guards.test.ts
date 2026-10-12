import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import {
  registerAdjustment,
  registerCapitalIncome,
  registerMainCashboxExpense,
  registerOpeningBalance,
  reverseMovement,
} from "@/modules/cash/commands";
import { loadSessionContext, type SessionContext } from "@/modules/identity/session";
import { AppError } from "@/shared/errors/app-error";
import type { IdempotencyKey } from "@/shared/ids/idempotency-key";
import { TestFixtures, createAdminClient } from "./helpers/auth";
import { createTestPool } from "./helpers/db";

// Barreras de los comandos de Caja Mayor (F2-T3): concurrencia, claves reutilizadas, replays,
// autorización con evento RECHAZADO, tipos reversibles y contenido de la auditoría.

const pool = createTestPool();
const fixtures = new TestFixtures(pool, createAdminClient());
const deps = { db: pool };

afterAll(async () => {
  await fixtures.purge();
  await pool.end();
});

const key = () => randomUUID() as IdempotencyKey;

async function newBusiness(): Promise<{ businessId: string; admin: SessionContext }> {
  const businessId = await fixtures.business("Caja barreras");
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

const count = async (businessId: string, where = "true") =>
  Number(
    (
      await pool.query<{ n: string }>(
        `select count(*) as n from public.cash_movements where business_id = $1 and ${where}`,
        [businessId],
      )
    ).rows[0]!.n,
  );

const auditEvents = async (businessId: string, action: string) =>
  (
    await pool.query<{
      actor_id: string;
      entity_type: string;
      entity_id: string;
      result: string;
      summary: Record<string, unknown>;
    }>(
      `select actor_id, entity_type, entity_id, result, summary
         from public.audit_events where business_id = $1 and action = $2`,
      [businessId, action],
    )
  ).rows;

describe("concurrencia de los comandos", () => {
  it("dos reversos simultáneos del mismo movimiento: uno se aplica y el otro es un 409 (no un 500)", async () => {
    const { businessId, admin } = await newBusiness();
    const income = await registerCapitalIncome(deps, admin, { idempotencyKey: key(), amount: 100 });

    const outcomes = await Promise.allSettled(
      [1, 2].map(() =>
        reverseMovement(deps, admin, {
          idempotencyKey: key(),
          movementId: income.result.movementId,
          reason: "Duplicado",
        }),
      ),
    );

    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((o) => o.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "MOVEMENT_ALREADY_REVERSED", status: 409 });
    expect(await count(businessId, "type = 'REVERSO'")).toBe(1);
  });

  it("dos saldos de apertura simultáneos: uno se aplica y el otro es un 409 (no un 500)", async () => {
    const { businessId, admin } = await newBusiness();

    const outcomes = await Promise.allSettled(
      [1, 2].map(() => registerOpeningBalance(deps, admin, { idempotencyKey: key(), amount: 50 })),
    );

    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((o) => o.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "OPENING_BALANCE_EXISTS", status: 409 });
    expect(await count(businessId, "type = 'SALDO_APERTURA'")).toBe(1);
  });

  it("el mismo gasto reenviado en paralelo con la misma clave se aplica una sola vez", async () => {
    const { businessId, admin } = await newBusiness();
    await registerCapitalIncome(deps, admin, { idempotencyKey: key(), amount: 1000 });
    const idempotencyKey = key();

    const outcomes = await Promise.all(
      Array.from({ length: 5 }, () =>
        registerMainCashboxExpense(deps, admin, {
          idempotencyKey,
          amount: 100,
          category: "GASOLINA",
        }),
      ),
    );

    expect(outcomes.filter((o) => !o.replayed)).toHaveLength(1);
    expect(new Set(outcomes.map((o) => o.result.movementId)).size).toBe(1);
    expect(await count(businessId, "type = 'GASTO_CAJA_MAYOR'")).toBe(1);
  });
});

describe("claves de idempotencia", () => {
  it("la misma clave con otro monto, otra observación o otra categoría es un 409 y no cambia nada", async () => {
    const { businessId, admin } = await newBusiness();
    await registerCapitalIncome(deps, admin, { idempotencyKey: key(), amount: 1000 });

    const capitalKey = key();
    await registerCapitalIncome(deps, admin, { idempotencyKey: capitalKey, amount: 10, note: "a" });
    for (const changed of [{ amount: 11, note: "a" }, { amount: 10, note: "b" }, { amount: 10 }]) {
      expect(
        await failureOf(
          registerCapitalIncome(deps, admin, { idempotencyKey: capitalKey, ...changed }),
        ),
        JSON.stringify(changed),
      ).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED", status: 409 });
    }

    const expenseKey = key();
    await registerMainCashboxExpense(deps, admin, {
      idempotencyKey: expenseKey,
      amount: 20,
      category: "GASOLINA",
    });
    expect(
      await failureOf(
        registerMainCashboxExpense(deps, admin, {
          idempotencyKey: expenseKey,
          amount: 20,
          category: "MEDICINA",
        }),
      ),
    ).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    expect(await count(businessId)).toBe(3);
  });

  it("reenviar un gasto o un reverso con la misma clave devuelve lo mismo sin repetirlo", async () => {
    const { businessId, admin } = await newBusiness();
    await registerCapitalIncome(deps, admin, { idempotencyKey: key(), amount: 500 });

    const expenseKey = key();
    const expense = { idempotencyKey: expenseKey, amount: 100, category: "REPARACION" as const };
    const first = await registerMainCashboxExpense(deps, admin, expense);
    const again = await registerMainCashboxExpense(deps, admin, expense);
    expect(again).toEqual({ result: first.result, replayed: true });

    const reversalKey = key();
    const reversal = {
      idempotencyKey: reversalKey,
      movementId: first.result.movementId,
      reason: "Error",
    };
    const reversed = await reverseMovement(deps, admin, reversal);
    const reversedAgain = await reverseMovement(deps, admin, reversal);
    expect(reversedAgain).toEqual({ result: reversed.result, replayed: true });

    expect(await count(businessId, "type = 'GASTO_CAJA_MAYOR'")).toBe(1);
    expect(await count(businessId, "type = 'REVERSO'")).toBe(1);
  });
});

describe("autorización de los comandos", () => {
  it("un cobrador recibe 403 y deja un evento RECHAZADO; el Super Admin, 403 sin evento", async () => {
    const { businessId } = await newBusiness();
    const collector = await loadSessionContext(
      (await fixtures.account({ role: "COBRADOR", businessId })).userId,
      pool,
    );
    const superAdmin = await loadSessionContext(
      (await fixtures.account({ role: "SUPER_ADMIN", businessId: null })).userId,
      pool,
    );

    expect(
      await failureOf(
        registerCapitalIncome(deps, collector, { idempotencyKey: key(), amount: 10 }),
      ),
    ).toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(
      await failureOf(
        registerCapitalIncome(deps, superAdmin, { idempotencyKey: key(), amount: 10 }),
      ),
    ).toMatchObject({ code: "FORBIDDEN", status: 403 });

    expect(await count(businessId)).toBe(0);
    const rejected = await pool.query<{ actor_id: string; result: string }>(
      "select actor_id, result from public.audit_events where business_id = $1 and action = 'RegistrarIngresoCapital'",
      [businessId],
    );
    expect(rejected.rows).toEqual([{ actor_id: collector.userId, result: "RECHAZADO" }]);
  });
});

describe("reverso: tipos y dirección", () => {
  it("reversa la apertura y los ajustes en ambas direcciones con el signo contrario", async () => {
    const { businessId, admin } = await newBusiness();
    const opening = await registerOpeningBalance(deps, admin, {
      idempotencyKey: key(),
      amount: 1000,
    });
    const up = await registerAdjustment(deps, admin, {
      idempotencyKey: key(),
      direction: "ENTRADA",
      amount: 300,
      reason: "Suma",
    });
    const down = await registerAdjustment(deps, admin, {
      idempotencyKey: key(),
      direction: "SALIDA",
      amount: 200,
      reason: "Resta",
    });
    expect(down.result.balance).toBe(1100);

    const undoDown = await reverseMovement(deps, admin, {
      idempotencyKey: key(),
      movementId: down.result.movementId,
      reason: "Deshacer resta",
    });
    expect(undoDown.result.balance).toBe(1300);
    const undoUp = await reverseMovement(deps, admin, {
      idempotencyKey: key(),
      movementId: up.result.movementId,
      reason: "Deshacer suma",
    });
    expect(undoUp.result.balance).toBe(1000);
    const undoOpening = await reverseMovement(deps, admin, {
      idempotencyKey: key(),
      movementId: opening.result.movementId,
      reason: "Apertura equivocada",
    });
    expect(undoOpening.result.balance).toBe(0);
    expect(await count(businessId, "type = 'REVERSO' and reason is not null")).toBe(3);
  });

  it("no reversa desde aquí los tipos que nacen en otras fases", async () => {
    const { businessId, admin } = await newBusiness();
    const box = await pool.query<{ id: string }>(
      "select id from public.main_cashboxes where business_id = $1",
      [businessId],
    );
    const foreign = await pool.query<{ id: string }>(
      `insert into public.cash_movements (business_id, cashbox_id, type, direction, amount, created_by)
       values ($1, $2, 'COBRO', 'ENTRADA', 100, $3) returning id`,
      [businessId, box.rows[0]!.id, admin.userId],
    );

    const error = await failureOf(
      reverseMovement(deps, admin, {
        idempotencyKey: key(),
        movementId: foreign.rows[0]!.id,
        reason: "No aplica",
      }),
    );

    expect(error).toMatchObject({ code: "MOVEMENT_NOT_REVERSIBLE", status: 409 });
  });
});

describe("auditoría y datos persistidos", () => {
  it("cada comando audita el actor, la entidad correcta y los datos que lo explican", async () => {
    const { businessId, admin } = await newBusiness();
    const income = await registerCapitalIncome(deps, admin, { idempotencyKey: key(), amount: 900 });
    const expense = await registerMainCashboxExpense(deps, admin, {
      idempotencyKey: key(),
      amount: 100,
      category: "MEDICINA",
      note: "Botiquín",
    });
    const adjustment = await registerAdjustment(deps, admin, {
      idempotencyKey: key(),
      direction: "SALIDA",
      amount: 50,
      reason: "Conteo",
    });
    const reversal = await reverseMovement(deps, admin, {
      idempotencyKey: key(),
      movementId: income.result.movementId,
      reason: "Duplicado",
    }).catch((error: AppError) => error);
    // El ingreso ya está en parte gastado: se reversa uno cuyo saldo alcanza.
    const reversed = await reverseMovement(deps, admin, {
      idempotencyKey: key(),
      movementId: adjustment.result.movementId,
      reason: "Duplicado",
    });
    expect(reversal).toBeInstanceOf(Error); // 900 − 100 − 50 = 750 < 900: no alcanza

    expect(await auditEvents(businessId, "GastoRegistrado")).toEqual([
      {
        actor_id: admin.userId,
        entity_type: "expense",
        entity_id: expense.result.expenseId,
        result: "OK",
        summary: { amount: 100, category: "MEDICINA", movementId: expense.result.movementId },
      },
    ]);
    expect(await auditEvents(businessId, "AjusteRegistrado")).toEqual([
      {
        actor_id: admin.userId,
        entity_type: "cash_movement",
        entity_id: adjustment.result.movementId,
        result: "OK",
        summary: { direction: "SALIDA", amount: 50, reason: "Conteo" },
      },
    ]);
    expect(await auditEvents(businessId, "ReversoRegistrado")).toEqual([
      {
        actor_id: admin.userId,
        entity_type: "cash_movement",
        entity_id: reversed.result.movementId,
        result: "OK",
        summary: {
          reversedMovementId: adjustment.result.movementId,
          reversedType: "AJUSTE",
          amount: 50,
          reason: "Duplicado",
        },
      },
    ]);

    const saved = await pool.query<{ type: string; reason: string | null; created_by: string }>(
      "select type, reason, created_by from public.cash_movements where id = any($1) order by type",
      [[adjustment.result.movementId, reversed.result.movementId]],
    );
    expect(saved.rows).toEqual([
      { type: "AJUSTE", reason: "Conteo", created_by: admin.userId },
      { type: "REVERSO", reason: "Duplicado", created_by: admin.userId },
    ]);
  });

  it("si falla el alta del gasto (el movimiento ya insertado) no queda ninguno de los dos", async () => {
    const { businessId, admin } = await newBusiness();
    await registerCapitalIncome(deps, admin, { idempotencyKey: key(), amount: 100 });
    // OTRO sin observación llega a la base si se salta la validación de entrada: el CHECK de expenses
    // rechaza el gasto y, con él, también el movimiento que ya se había insertado.
    const error = await registerMainCashboxExpense(deps, admin, {
      idempotencyKey: key(),
      amount: 10,
      category: "OTRO",
    }).catch((failure: unknown) => failure);

    expect(error).toMatchObject({ code: "23514" });
    expect(await count(businessId, "type = 'GASTO_CAJA_MAYOR'")).toBe(0);
    expect(await auditEvents(businessId, "GastoRegistrado")).toEqual([]);
  });
});
