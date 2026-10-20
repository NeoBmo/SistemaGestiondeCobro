import type { Pool } from "pg";
import { withTransaction, type Tx } from "@/shared/database/with-transaction";
import { recordAuditEvent } from "./record-audit-event";

type RejectedActor = { userId: string; role: string };

export type RejectedAttempt = {
  actor: RejectedActor;
  businessId: string;
  /** El evento que se habría generado si el comando se hubiera aplicado. */
  action: string;
  entityType: string;
  entityId: string;
};

/**
 * Deja un evento `RECHAZADO` (ADR 0005) cuando un actor autenticado intenta algo para lo que no tiene
 * permiso sobre una entidad que existe. Para que un usuario no pueda inundar la auditoría repitiendo el
 * intento se guarda un solo evento por actor, acción y entidad por minuto. Es de mejor esfuerzo: nunca
 * debe tapar el 403 que el llamador devuelve a continuación.
 *
 * `exists` comprueba, dentro de la misma transacción, que la entidad existe: si no, no hay nada que
 * auditar (y la respuesta no revela qué entidades existen).
 */
export async function recordRejectedAttempt(
  db: Pick<Pool, "connect">,
  attempt: RejectedAttempt,
  exists: (tx: Tx) => Promise<boolean>,
): Promise<void> {
  try {
    await withTransaction(async (tx) => {
      if (!(await exists(tx))) return;
      const recent = await tx.query(
        `select 1 from public.audit_events
          where actor_id = $1 and entity_id = $2 and action = $3 and result = 'RECHAZADO'
            and occurred_at > now() - interval '1 minute'`,
        [attempt.actor.userId, attempt.entityId, attempt.action],
      );
      if ((recent.rowCount ?? 0) > 0) return;
      await recordAuditEvent(tx, {
        businessId: attempt.businessId,
        actorId: attempt.actor.userId,
        action: attempt.action,
        entityType: attempt.entityType,
        entityId: attempt.entityId,
        result: "RECHAZADO",
        summary: { reason: "FORBIDDEN", role: attempt.actor.role },
      });
    }, db);
  } catch {
    // Solo el hecho: el motivo del fallo puede contener datos de la conexión.
    console.error("[authorize] no se pudo registrar el evento RECHAZADO");
  }
}
