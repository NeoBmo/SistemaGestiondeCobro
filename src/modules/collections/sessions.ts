import { randomUUID } from "node:crypto";
import { insertMovement } from "@/modules/cash/commands";
import { runCashCommand, type CashCommandOutcome } from "@/modules/cash/run-cash-command";
import type { ExpenseCategory } from "@/modules/cash/validation";
import type { SessionContext } from "@/modules/identity/session";
import type { Tx } from "@/shared/database/with-transaction";
import { localDateIn } from "@/shared/dates/dates";
import { AppError } from "@/shared/errors/app-error";
import type { IdempotencyKey } from "@/shared/ids/idempotency-key";
import type { ContractDeps } from "@/modules/portfolio/contracts";

/**
 * Jornada de Caja Menor (02 §5.2, ADR 0009). La abre el cobrador (empieza en cero), el Admin le transfiere
 * fondo desde la Caja Mayor y el cobrador registra cobros y gastos contra ella. Son comandos financieros sobre
 * `runCashCommand`: una transacción, bloqueo de la caja, idempotencia y auditoría.
 */

type Base = { idempotencyKey: IdempotencyKey };

export type OpenedSession = { sessionId: string; businessDate: string };

/** El cobrador abre su jornada: una sola abierta o pendiente a la vez, y solo si su cuenta está activa. */
export function openSession(
  deps: ContractDeps,
  actor: SessionContext,
  input: Base,
  now: () => Date = () => new Date(),
): Promise<CashCommandOutcome<OpenedSession>> {
  return runCashCommand<OpenedSession>(deps, {
    name: "AbrirJornada",
    role: "COBRADOR",
    actor,
    idempotencyKey: input.idempotencyKey,
    input: {},
    execute: async (tx, context) => {
      const existing = await tx.query<{ status: string }>(
        `select status from public.cash_sessions
          where collector_id = $1 and status in ('ABIERTA', 'PENDIENTE_LIQUIDACION')`,
        [context.collectorId],
      );
      if (existing.rows[0]) {
        throw new AppError(
          "SESSION_ALREADY_OPEN",
          existing.rows[0].status === "ABIERTA"
            ? "Ya tienes una jornada abierta"
            : "Tienes una jornada pendiente de liquidación: espera a que el administrador la confirme",
          409,
        );
      }
      const zone = await tx.query<{ time_zone: string }>(
        "select time_zone from public.businesses where id = $1",
        [context.businessId],
      );
      const businessDate = localDateIn(now(), zone.rows[0]!.time_zone);
      const created = await tx.query<{ id: string }>(
        `insert into public.cash_sessions (business_id, collector_id, business_date)
         values ($1, $2, $3) returning id`,
        [context.businessId, context.collectorId, businessDate],
      );
      const sessionId = created.rows[0]!.id;
      return {
        result: { sessionId, businessDate },
        audit: [
          {
            action: "JornadaAbierta",
            entityType: "cash_session",
            entityId: sessionId,
            summary: { collectorId: context.collectorId, businessDate },
          },
        ],
      };
    },
  });
}

export type TransferredFund = {
  sessionId: string;
  amount: number;
  /** Saldo de la Caja Mayor después de transferir. */
  balance: number;
  /** Saldo de la Caja Menor de la jornada después de recibir el fondo. */
  sessionBalance: number;
};

/**
 * El Admin transfiere fondo operativo a una jornada `ABIERTA` (una o más veces; ADR 0009): una salida de la
 * Caja Mayor y su entrada espejo en la Caja Menor, por el mismo importe. Sin saldo en la Mayor se rechaza.
 */
export function transferFund(
  deps: ContractDeps,
  actor: SessionContext,
  input: Base & { sessionId: string; amount: number },
): Promise<CashCommandOutcome<TransferredFund>> {
  const { idempotencyKey, ...content } = input;
  return runCashCommand<TransferredFund>(deps, {
    name: "TransferirFondo",
    actor,
    idempotencyKey,
    input: content,
    execute: async (tx, context) => {
      const session = await lockSession(tx, context.businessId, input.sessionId);
      if (session.status !== "ABIERTA") {
        throw new AppError(
          "SESSION_NOT_OPEN",
          "Solo se transfiere fondo a una jornada abierta",
          409,
        );
      }
      const collector = await tx.query<{ status: string }>(
        "select status from public.collectors where id = $1",
        [session.collector_id],
      );
      if (collector.rows[0]?.status !== "ACTIVO") {
        throw new AppError("COLLECTOR_INACTIVE", "El cobrador está inactivo", 409);
      }
      const reference = { type: "session", id: input.sessionId };
      const outflow = await insertMovement(tx, context, {
        type: "FONDO_OPERATIVO",
        direction: "SALIDA",
        amount: input.amount,
        reference,
      });
      const inflow = await insertMovement(tx, context, {
        type: "FONDO_OPERATIVO",
        direction: "ENTRADA",
        amount: input.amount,
        reference,
        sessionId: input.sessionId,
      });
      return {
        result: {
          sessionId: input.sessionId,
          amount: input.amount,
          balance: outflow.balance,
          sessionBalance: inflow.balance,
        },
        audit: [
          {
            action: "FondoOperativoTransferido",
            entityType: "cash_session",
            entityId: input.sessionId,
            summary: {
              amount: input.amount,
              collectorId: session.collector_id,
              movementIds: [outflow.id, inflow.id],
            },
          },
        ],
      };
    },
  });
}

export type CollectorExpenseResult = {
  expenseId: string;
  movementId: string;
  /** Saldo esperado de la jornada después del gasto. */
  sessionBalance: number;
};

/**
 * El cobrador registra un gasto de su jornada abierta (02 §5.4): sale de su Caja Menor y reduce el saldo
 * esperado. Si el gasto dejaría la caja de la jornada en negativo se rechaza (ADR 0009).
 */
export function registerCollectorExpense(
  deps: ContractDeps,
  actor: SessionContext,
  input: Base & { amount: number; category: ExpenseCategory; note?: string },
  now: () => Date = () => new Date(),
): Promise<CashCommandOutcome<CollectorExpenseResult>> {
  const { idempotencyKey, ...content } = input;
  return runCashCommand<CollectorExpenseResult>(deps, {
    name: "RegistrarGastoCobrador",
    role: "COBRADOR",
    actor,
    idempotencyKey,
    input: content,
    execute: async (tx, context) => {
      const open = await tx.query<{ id: string }>(
        "select id from public.cash_sessions where collector_id = $1 and status = 'ABIERTA'",
        [context.collectorId],
      );
      const sessionId = open.rows[0]?.id;
      if (!sessionId) {
        throw new AppError("NO_OPEN_SESSION", "Abre tu jornada antes de registrar un gasto", 409);
      }
      const expenseId = randomUUID();
      const movement = await insertMovement(tx, context, {
        type: "GASTO_COBRADOR",
        direction: "SALIDA",
        amount: input.amount,
        note: input.note,
        reference: { type: "expense", id: expenseId },
        sessionId,
      });
      const zone = await tx.query<{ time_zone: string }>(
        "select time_zone from public.businesses where id = $1",
        [context.businessId],
      );
      await tx.query(
        `insert into public.expenses
           (id, business_id, cashbox_id, session_id, movement_id, category, amount, spent_on, note, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          expenseId,
          context.businessId,
          context.cashboxId,
          sessionId,
          movement.id,
          input.category,
          input.amount,
          localDateIn(now(), zone.rows[0]!.time_zone),
          input.note ?? null,
          context.actorId,
        ],
      );
      return {
        result: { expenseId, movementId: movement.id, sessionBalance: movement.balance },
        audit: [
          {
            action: "GastoRegistrado",
            entityType: "expense",
            entityId: expenseId,
            summary: {
              amount: input.amount,
              category: input.category,
              movementId: movement.id,
              sessionId,
            },
          },
        ],
      };
    },
  });
}

async function lockSession(
  tx: Tx,
  businessId: string,
  sessionId: string,
): Promise<{ status: string; collector_id: string }> {
  const { rows } = await tx.query<{ status: string; collector_id: string }>(
    "select status, collector_id from public.cash_sessions where id = $1 and business_id = $2 for no key update",
    [sessionId, businessId],
  );
  if (!rows[0]) throw new AppError("SESSION_NOT_FOUND", "La jornada no existe", 404);
  return rows[0];
}
