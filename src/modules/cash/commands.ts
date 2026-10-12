import { randomUUID } from "node:crypto";
import type { SessionContext } from "@/modules/identity/session";
import type { Tx } from "@/shared/database/with-transaction";
import { localDateIn } from "@/shared/dates/dates";
import { AppError } from "@/shared/errors/app-error";
import type { IdempotencyKey } from "@/shared/ids/idempotency-key";
import { money, subtractMoney, type Money } from "@/shared/money/money";
import { getCashboxBalance } from "./balance";
import {
  runCashCommand,
  type CashCommand,
  type CashCommandAudit,
  type CashCommandContext,
  type CashCommandOutcome,
  type RunCashCommandDeps,
} from "./run-cash-command";
import { REVERSIBLE_TYPES } from "./presentation";
import type { ExpenseCategory } from "./validation";

/**
 * Comandos de Caja Mayor de F2 (02 §5.1, §5.3, §5.4; ADR 0006). Todos son del Admin de negocio y pasan
 * por `runCashCommand`: una transacción, bloqueo de la caja, idempotencia y auditoría. Cada uno
 * comprueba el saldo antes de insertar una salida para dar un error claro; la base lo garantiza además
 * al confirmar (invariante 14).
 */

export type MovementResult = {
  movementId: string;
  /** Saldo de la Caja Mayor después del movimiento. */
  balance: number;
};

type Base = { idempotencyKey: IdempotencyKey };
type Direction = "ENTRADA" | "SALIDA";

const insufficientFunds = () =>
  new AppError(
    "INSUFFICIENT_FUNDS",
    "La Caja Mayor no tiene saldo suficiente para esta operación",
    409,
  );

type MovementInsert = {
  type: string;
  direction: Direction;
  amount: number;
  reason?: string | null;
  note?: string | null;
  reverses?: string | null;
  reference?: { type: string; id: string };
};

async function insertMovement(
  tx: Tx,
  context: CashCommandContext,
  movement: MovementInsert,
): Promise<{ id: string; balance: Money }> {
  const before = await getCashboxBalance(tx, context.cashboxId);
  if (movement.direction === "SALIDA" && before < movement.amount) throw insufficientFunds();

  const { rows } = await tx.query<{ id: string }>(
    `insert into public.cash_movements
       (business_id, cashbox_id, type, direction, amount, reason, note, reverses_movement_id,
        reference_type, reference_id, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
    [
      context.businessId,
      context.cashboxId,
      movement.type,
      movement.direction,
      movement.amount,
      movement.reason ?? null,
      movement.note ?? null,
      movement.reverses ?? null,
      movement.reference?.type ?? null,
      movement.reference?.id ?? null,
      context.actorId,
    ],
  );
  const balance =
    movement.direction === "ENTRADA"
      ? money(before + movement.amount)
      : subtractMoney(before, money(movement.amount));
  return { id: rows[0]!.id, balance };
}

function run<R>(
  deps: RunCashCommandDeps,
  actor: SessionContext,
  name: string,
  input: Base & Record<string, unknown>,
  execute: CashCommand<R>["execute"],
): Promise<CashCommandOutcome<R>> {
  const { idempotencyKey, ...content } = input;
  return runCashCommand(deps, { name, actor, idempotencyKey, input: content, execute });
}

const movementAudit = (
  action: string,
  movementId: string,
  summary: Record<string, unknown>,
): CashCommandAudit[] => [{ action, entityType: "cash_movement", entityId: movementId, summary }];

/** Saldo de apertura: uno por negocio (la base lo impone con un índice único; aquí, un error claro). */
export function registerOpeningBalance(
  deps: RunCashCommandDeps,
  actor: SessionContext,
  input: Base & { amount: number; note?: string },
) {
  return run<MovementResult>(deps, actor, "RegistrarSaldoApertura", input, async (tx, context) => {
    const existing = await tx.query(
      "select 1 from public.cash_movements where business_id = $1 and type = 'SALDO_APERTURA'",
      [context.businessId],
    );
    if ((existing.rowCount ?? 0) > 0) {
      throw new AppError(
        "OPENING_BALANCE_EXISTS",
        "El negocio ya tiene un saldo de apertura. Para corregirlo usa un ajuste o un reverso",
        409,
      );
    }
    const movement = await insertMovement(tx, context, {
      type: "SALDO_APERTURA",
      direction: "ENTRADA",
      amount: input.amount,
      note: input.note,
    });
    return {
      result: { movementId: movement.id, balance: movement.balance },
      audit: movementAudit("SaldoAperturaRegistrado", movement.id, { amount: input.amount }),
    };
  });
}

export function registerCapitalIncome(
  deps: RunCashCommandDeps,
  actor: SessionContext,
  input: Base & { amount: number; note?: string },
) {
  return run<MovementResult>(deps, actor, "RegistrarIngresoCapital", input, async (tx, context) => {
    const movement = await insertMovement(tx, context, {
      type: "INGRESO_CAPITAL",
      direction: "ENTRADA",
      amount: input.amount,
      note: input.note,
    });
    return {
      result: { movementId: movement.id, balance: movement.balance },
      audit: movementAudit("CapitalIngresado", movement.id, { amount: input.amount }),
    };
  });
}

export type ExpenseResult = MovementResult & { expenseId: string };

/** Gasto directo de Caja Mayor (02 §5.4): el gasto y su movimiento son entidades separadas. */
export function registerMainCashboxExpense(
  deps: RunCashCommandDeps,
  actor: SessionContext,
  input: Base & { amount: number; category: ExpenseCategory; note?: string },
  now: () => Date = () => new Date(),
) {
  return run<ExpenseResult>(deps, actor, "RegistrarGastoCajaMayor", input, async (tx, context) => {
    const expenseId = randomUUID();
    const movement = await insertMovement(tx, context, {
      type: "GASTO_CAJA_MAYOR",
      direction: "SALIDA",
      amount: input.amount,
      note: input.note,
      reference: { type: "expense", id: expenseId },
    });
    // La fecha del gasto es «hoy» en la zona horaria del negocio, no la del servidor ni la del navegador.
    const zone = await tx.query<{ time_zone: string }>(
      "select time_zone from public.businesses where id = $1",
      [context.businessId],
    );
    await tx.query(
      `insert into public.expenses
         (id, business_id, cashbox_id, movement_id, category, amount, spent_on, note, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        expenseId,
        context.businessId,
        context.cashboxId,
        movement.id,
        input.category,
        input.amount,
        localDateIn(now(), zone.rows[0]!.time_zone),
        input.note ?? null,
        context.actorId,
      ],
    );
    return {
      result: { movementId: movement.id, expenseId, balance: movement.balance },
      audit: [
        {
          action: "GastoRegistrado",
          entityType: "expense",
          entityId: expenseId,
          summary: { amount: input.amount, category: input.category, movementId: movement.id },
        },
      ],
    };
  });
}

/** Ajuste ± con motivo (02 §5.3): la dirección es explícita; nunca edita el movimiento que corrige. */
export function registerAdjustment(
  deps: RunCashCommandDeps,
  actor: SessionContext,
  input: Base & { direction: Direction; amount: number; reason: string },
) {
  return run<MovementResult>(deps, actor, "RegistrarAjusteCaja", input, async (tx, context) => {
    const movement = await insertMovement(tx, context, {
      type: "AJUSTE",
      direction: input.direction,
      amount: input.amount,
      reason: input.reason,
    });
    return {
      result: { movementId: movement.id, balance: movement.balance },
      audit: movementAudit("AjusteRegistrado", movement.id, {
        direction: input.direction,
        amount: input.amount,
        reason: input.reason,
      }),
    };
  });
}

/** Reverso total y único de un movimiento propio de F2, con motivo. */
export function reverseMovement(
  deps: RunCashCommandDeps,
  actor: SessionContext,
  input: Base & { movementId: string; reason: string },
) {
  return run<MovementResult>(deps, actor, "ReversarMovimientoCaja", input, async (tx, context) => {
    // Siempre dentro del negocio de la sesión: un id de otro negocio es «no encontrado» (regla 1).
    const original = await tx.query<{
      id: string;
      type: string;
      direction: Direction;
      amount: string;
    }>(
      `select id, type, direction, amount::text as amount from public.cash_movements
        where id = $1 and business_id = $2`,
      [input.movementId, context.businessId],
    );
    const target = original.rows[0];
    if (!target) throw new AppError("MOVEMENT_NOT_FOUND", "El movimiento no existe", 404);
    if (!(REVERSIBLE_TYPES as readonly string[]).includes(target.type)) {
      throw new AppError(
        "MOVEMENT_NOT_REVERSIBLE",
        "Este tipo de movimiento no se puede reversar desde la Caja Mayor",
        409,
      );
    }
    const already = await tx.query(
      "select 1 from public.cash_movements where reverses_movement_id = $1",
      [target.id],
    );
    if ((already.rowCount ?? 0) > 0) {
      throw new AppError("MOVEMENT_ALREADY_REVERSED", "Este movimiento ya fue reversado", 409);
    }

    const movement = await insertMovement(tx, context, {
      type: "REVERSO",
      direction: target.direction === "ENTRADA" ? "SALIDA" : "ENTRADA",
      amount: money(target.amount),
      reason: input.reason,
      reverses: target.id,
    });
    return {
      result: { movementId: movement.id, balance: movement.balance },
      audit: movementAudit("ReversoRegistrado", movement.id, {
        reversedMovementId: target.id,
        reversedType: target.type,
        amount: money(target.amount),
        reason: input.reason,
      }),
    };
  });
}
