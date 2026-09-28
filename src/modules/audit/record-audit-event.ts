import type { Tx } from "@/shared/database/with-transaction";

export type AuditEventInput = {
  /** `null` para acciones de plataforma que no pertenecen a un negocio. */
  businessId: string | null;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  /** Resumen seguro del cambio: nunca contraseñas, tokens ni documentos completos (03 §7). */
  summary?: Record<string, unknown>;
  result?: "OK" | "RECHAZADO";
};

/** Registra la acción en `audit_events`. Debe llamarse dentro de la misma transacción del comando. */
export async function recordAuditEvent(tx: Tx, event: AuditEventInput): Promise<void> {
  await tx.query(
    `insert into public.audit_events (business_id, actor_id, action, entity_type, entity_id, result, summary)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      event.businessId,
      event.actorId,
      event.action,
      event.entityType,
      event.entityId,
      event.result ?? "OK",
      JSON.stringify(event.summary ?? {}),
    ],
  );
}
