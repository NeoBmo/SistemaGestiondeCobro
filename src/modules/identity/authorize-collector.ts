import type { Pool } from "pg";
import { recordRejectedAttempt } from "@/modules/audit/record-rejection";
import { AppError } from "@/shared/errors/app-error";
import { authorizeSession, type SessionContext } from "./session";

/**
 * Solo el Cobrador, con la contraseña temporal ya cambiada. Devuelve el negocio de la sesión (nunca uno
 * que venga de la petición, regla 1). Un Admin (autenticado, con negocio) que lo intenta deja un evento
 * `RECHAZADO` con `commandName` como acción (ADR 0005); el Super Admin no tiene negocio y recibe el 403 sin
 * evento. Es el espejo de `authorizeBusinessAdmin` para las operaciones propias del cobrador (02 §8).
 */
export async function authorizeCollector(
  db: Pick<Pool, "connect">,
  actor: SessionContext,
  commandName: string,
): Promise<string> {
  try {
    authorizeSession(actor, { roles: ["COBRADOR"] });
  } catch (error) {
    if (actor.businessId && (error as { code?: string }).code === "FORBIDDEN") {
      const businessId = actor.businessId;
      await recordRejectedAttempt(
        db,
        { actor, businessId, action: commandName, entityType: "business", entityId: businessId },
        async () => true,
      );
    }
    throw error;
  }
  if (!actor.businessId) {
    throw new AppError("FORBIDDEN", "No tienes permiso para esta operación", 403);
  }
  return actor.businessId;
}
