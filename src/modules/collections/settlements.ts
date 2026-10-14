import { getCashboxBalance } from "@/modules/cash/balance";
import { insertMovement } from "@/modules/cash/commands";
import { runCashCommand, type CashCommandOutcome } from "@/modules/cash/run-cash-command";
import type { SessionContext } from "@/modules/identity/session";
import type { ContractDeps } from "@/modules/portfolio/contracts";
import type { Tx } from "@/shared/database/with-transaction";
import { AppError } from "@/shared/errors/app-error";
import type { IdempotencyKey } from "@/shared/ids/idempotency-key";

/**
 * Liquidación de la jornada (02 §5.5, ADR 0009). El cobrador declara lo que entrega (la jornada pasa a
 * `PENDIENTE_LIQUIDACION`); el Admin confirma con lo que realmente recibió: ese dinero entra a la Caja Mayor,
 * la diferencia (faltante o sobrante) se registra y exige observación, y la jornada queda en cero. Resolver
 * una diferencia es un `AJUSTE` nuevo de la Caja Mayor: la liquidación previa nunca cambia.
 */

type Base = { idempotencyKey: IdempotencyKey };

export type DeclaredSettlement = {
  settlementId: string;
  sessionId: string;
  declaredAmount: number;
  /** Saldo esperado de la jornada al declarar: fondo + cobros − gastos (derivado). */
  expectedAmount: number;
};

/** El cobrador cierra su jornada abierta y declara lo que entrega. */
export function declareSettlement(
  deps: ContractDeps,
  actor: SessionContext,
  input: Base & { declaredAmount: number },
): Promise<CashCommandOutcome<DeclaredSettlement>> {
  return runCashCommand<DeclaredSettlement>(deps, {
    name: "DeclararLiquidacion",
    role: "COBRADOR",
    actor,
    idempotencyKey: input.idempotencyKey,
    input: { declaredAmount: input.declaredAmount },
    execute: async (tx, context) => {
      const open = await tx.query<{ id: string }>(
        `select id from public.cash_sessions
          where collector_id = $1 and status = 'ABIERTA' for no key update`,
        [context.collectorId],
      );
      const sessionId = open.rows[0]?.id;
      if (!sessionId) {
        throw new AppError("NO_OPEN_SESSION", "No tienes una jornada abierta para liquidar", 409);
      }
      const expected = await getCashboxBalance(tx, context.cashboxId, sessionId);
      const settlement = await tx.query<{ id: string }>(
        `insert into public.settlements (business_id, session_id, collector_id, declared_amount, declared_by)
         values ($1, $2, $3, $4, $5) returning id`,
        [context.businessId, sessionId, context.collectorId, input.declaredAmount, context.actorId],
      );
      await tx.query(
        "update public.cash_sessions set status = 'PENDIENTE_LIQUIDACION', declared_at = now() where id = $1",
        [sessionId],
      );
      const settlementId = settlement.rows[0]!.id;
      return {
        result: {
          settlementId,
          sessionId,
          declaredAmount: input.declaredAmount,
          expectedAmount: expected,
        },
        audit: [
          {
            action: "LiquidacionDeclarada",
            entityType: "settlement",
            entityId: settlementId,
            summary: {
              sessionId,
              collectorId: context.collectorId,
              declaredAmount: input.declaredAmount,
              expectedAmount: expected,
            },
          },
        ],
      };
    },
  });
}

export type ConfirmedSettlement = {
  settlementId: string;
  sessionId: string;
  expectedAmount: number;
  receivedAmount: number;
  /** Esperado − recibido: positivo es faltante, negativo sobrante, cero cuadra. */
  difference: number;
  status: "CUADRADA" | "CON_DIFERENCIA";
  /** Saldo de la Caja Mayor después de recibir el dinero. */
  balance: number;
};

type LockedSettlement = { id: string; session_id: string; status: string };

async function lockSettlement(
  tx: Tx,
  businessId: string,
  settlementId: string,
): Promise<LockedSettlement> {
  const { rows } = await tx.query<LockedSettlement>(
    `select id, session_id, status from public.settlements
      where id = $1 and business_id = $2 for no key update`,
    [settlementId, businessId],
  );
  if (!rows[0]) throw new AppError("SETTLEMENT_NOT_FOUND", "La liquidación no existe", 404);
  return rows[0];
}

/**
 * El Admin confirma la liquidación con el dinero realmente recibido. La diferencia con el saldo esperado se
 * registra (faltante o sobrante), exige observación y cierra la jornada en cero.
 */
export function confirmSettlement(
  deps: ContractDeps,
  actor: SessionContext,
  input: Base & { settlementId: string; receivedAmount: number; observation?: string },
): Promise<CashCommandOutcome<ConfirmedSettlement>> {
  const { idempotencyKey, ...content } = input;
  return runCashCommand<ConfirmedSettlement>(deps, {
    name: "ConfirmarLiquidacion",
    actor,
    idempotencyKey,
    input: content,
    execute: async (tx, context) => {
      const settlement = await lockSettlement(tx, context.businessId, input.settlementId);
      if (settlement.status !== "PENDIENTE_REVISION") {
        throw new AppError(
          "SETTLEMENT_ALREADY_CONFIRMED",
          "Esta liquidación ya fue confirmada",
          409,
        );
      }
      const sessionId = settlement.session_id;
      await tx.query("select 1 from public.cash_sessions where id = $1 for no key update", [
        sessionId,
      ]);

      const expected = await getCashboxBalance(tx, context.cashboxId, sessionId);
      const difference = expected - input.receivedAmount;
      if (difference !== 0 && !input.observation) {
        throw new AppError(
          "OBSERVATION_REQUIRED",
          "Hay una diferencia con lo esperado: escribe una observación",
          400,
        );
      }

      const reference = { type: "session", id: sessionId };
      const link = { type: "settlement", id: settlement.id };
      let balance: number = await getCashboxBalance(tx, context.cashboxId);
      // Un sobrante entra primero a la jornada para poder entregar todo lo recibido.
      if (difference < 0) {
        await insertMovement(tx, context, {
          type: "DIFERENCIA_CAJA",
          direction: "ENTRADA",
          amount: -difference,
          note: input.observation,
          reference: link,
          sessionId,
        });
      }
      if (input.receivedAmount > 0) {
        const inflow = await insertMovement(tx, context, {
          type: "LIQUIDACION",
          direction: "ENTRADA",
          amount: input.receivedAmount,
          reference,
        });
        balance = inflow.balance;
        await insertMovement(tx, context, {
          type: "LIQUIDACION",
          direction: "SALIDA",
          amount: input.receivedAmount,
          reference,
          sessionId,
        });
      }
      // Un faltante sale de la jornada: la deja en cero sin tocar la Caja Mayor.
      if (difference > 0) {
        await insertMovement(tx, context, {
          type: "DIFERENCIA_CAJA",
          direction: "SALIDA",
          amount: difference,
          note: input.observation,
          reference: link,
          sessionId,
        });
      }

      const status = difference === 0 ? "CUADRADA" : "CON_DIFERENCIA";
      await tx.query(
        `update public.settlements
            set status = $2, expected_amount = $3, received_amount = $4, difference = $5,
                observation = $6, confirmed_by = $7, confirmed_at = now()
          where id = $1`,
        [
          settlement.id,
          status,
          expected,
          input.receivedAmount,
          difference,
          input.observation ?? null,
          context.actorId,
        ],
      );
      await tx.query(
        "update public.cash_sessions set status = $2, closed_at = now() where id = $1",
        [sessionId, difference === 0 ? "LIQUIDADA" : "LIQUIDADA_CON_DIFERENCIA"],
      );

      return {
        result: {
          settlementId: settlement.id,
          sessionId,
          expectedAmount: expected,
          receivedAmount: input.receivedAmount,
          difference,
          status,
          balance,
        },
        audit: [
          {
            action: "LiquidacionConfirmada",
            entityType: "settlement",
            entityId: settlement.id,
            summary: {
              sessionId,
              expectedAmount: expected,
              receivedAmount: input.receivedAmount,
              difference,
            },
          },
          ...(difference === 0
            ? []
            : [
                {
                  action: "DiferenciaRegistrada",
                  entityType: "settlement",
                  entityId: settlement.id,
                  summary: {
                    kind: difference > 0 ? "FALTANTE" : "SOBRANTE",
                    amount: Math.abs(difference),
                    observation: input.observation,
                  },
                },
              ]),
        ],
      };
    },
  });
}

export type ResolvedDifference = {
  settlementId: string;
  movementId: string;
  amount: number;
  direction: "ENTRADA" | "SALIDA";
  balance: number;
};

/**
 * El Admin resuelve una diferencia con un `AJUSTE` de la Caja Mayor por el importe de la diferencia (un
 * faltante repuesto entra; un sobrante devuelto sale). Una sola vez; la liquidación no cambia.
 */
export function resolveDifference(
  deps: ContractDeps,
  actor: SessionContext,
  input: Base & { settlementId: string; note: string },
): Promise<CashCommandOutcome<ResolvedDifference>> {
  const { idempotencyKey, ...content } = input;
  return runCashCommand<ResolvedDifference>(deps, {
    name: "ResolverDiferencia",
    actor,
    idempotencyKey,
    input: content,
    execute: async (tx, context) => {
      const found = await lockSettlement(tx, context.businessId, input.settlementId);
      if (found.status !== "CON_DIFERENCIA") {
        throw new AppError(
          "SETTLEMENT_WITHOUT_DIFFERENCE",
          "Solo se resuelve una liquidación con diferencia",
          409,
        );
      }
      const resolved = await tx.query(
        "select 1 from public.settlement_resolutions where settlement_id = $1",
        [found.id],
      );
      if ((resolved.rowCount ?? 0) > 0) {
        throw new AppError("DIFFERENCE_ALREADY_RESOLVED", "Esta diferencia ya fue resuelta", 409);
      }
      const row = await tx.query<{ difference: string }>(
        "select difference::text from public.settlements where id = $1",
        [found.id],
      );
      const difference = Number(row.rows[0]!.difference);
      const direction = difference > 0 ? "ENTRADA" : "SALIDA";
      const adjustment = await insertMovement(tx, context, {
        type: "AJUSTE",
        direction,
        amount: Math.abs(difference),
        reason: `Resolución de la diferencia de la liquidación: ${input.note}`,
        reference: { type: "settlement", id: found.id },
      });
      await tx.query(
        `insert into public.settlement_resolutions (business_id, settlement_id, movement_id, note, resolved_by)
         values ($1, $2, $3, $4, $5)`,
        [context.businessId, found.id, adjustment.id, input.note, context.actorId],
      );
      return {
        result: {
          settlementId: found.id,
          movementId: adjustment.id,
          amount: Math.abs(difference),
          direction,
          balance: adjustment.balance,
        },
        audit: [
          {
            action: "AjusteRegistrado",
            entityType: "settlement",
            entityId: found.id,
            summary: {
              amount: Math.abs(difference),
              direction,
              note: input.note,
              movementId: adjustment.id,
            },
          },
        ],
      };
    },
  });
}
