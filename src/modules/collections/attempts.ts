import { randomUUID } from "node:crypto";
import { runCashCommand, type CashCommandOutcome } from "@/modules/cash/run-cash-command";
import type { SessionContext } from "@/modules/identity/session";
import type { ContractDeps } from "@/modules/portfolio/contracts";
import { AppError } from "@/shared/errors/app-error";
import type { IdempotencyKey } from "@/shared/ids/idempotency-key";
import type { AttemptInput } from "./validation";

/**
 * Intento de cobro (02 §4.4): un intento fallido o un «volver a cobrar» sobre un cliente de la cartera del
 * cobrador. No altera la deuda ni crea cuotas. Pasa por el ejecutor de comandos por la idempotencia y la
 * auditoría (no mueve dinero). Un cliente que no es de su cartera es «no encontrado»: no se revela.
 */

export type RegisteredAttempt = {
  attemptId: string;
  clientId: string;
  type: AttemptInput["type"];
};

export function registerAttempt(
  deps: ContractDeps,
  actor: SessionContext,
  input: AttemptInput & { idempotencyKey: IdempotencyKey },
): Promise<CashCommandOutcome<RegisteredAttempt>> {
  const { idempotencyKey, ...content } = input;
  return runCashCommand<RegisteredAttempt>(deps, {
    name: input.type === "INTENTO_FALLIDO" ? "RegistrarIntentoFallido" : "RegistrarVolverACobrar",
    role: "COBRADOR",
    actor,
    idempotencyKey,
    input: content,
    execute: async (tx, context) => {
      // La asignación se bloquea: reasignar el cliente a la vez no deja un intento de un cobrador que ya no lo tiene.
      const assigned = await tx.query(
        `select 1 from public.client_assignments
          where client_id = $1 and collector_id = $2 and business_id = $3 and status = 'ACTIVA' for share`,
        [input.clientId, context.collectorId, context.businessId],
      );
      if ((assigned.rowCount ?? 0) === 0) {
        throw new AppError("CLIENT_NOT_FOUND", "El cliente no existe", 404);
      }
      const attemptId = randomUUID();
      await tx.query(
        `insert into public.collection_attempts
           (id, business_id, client_id, collector_id, type, reason, note, retry_at, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          attemptId,
          context.businessId,
          input.clientId,
          context.collectorId,
          input.type,
          input.reason ?? null,
          input.note ?? null,
          input.retryAt ?? null,
          context.actorId,
        ],
      );
      return {
        result: { attemptId, clientId: input.clientId, type: input.type },
        audit: [
          {
            action:
              input.type === "INTENTO_FALLIDO" ? "IntentoCobroFallido" : "VolverACobrarProgramado",
            entityType: "collection_attempt",
            entityId: attemptId,
            summary: {
              clientId: input.clientId,
              collectorId: context.collectorId,
              ...(input.reason ? { reason: input.reason } : {}),
              ...(input.retryAt ? { retryAt: input.retryAt } : {}),
            },
          },
        ],
      };
    },
  });
}
