import type { Pool } from "pg";
import { recordRejectedAttempt } from "@/modules/audit/record-rejection";
import { AppError } from "@/shared/errors/app-error";
import { authorizeSession, type SessionContext } from "./session";

/**
 * Solo el Admin de negocio, con la contraseña temporal ya cambiada. Devuelve el negocio de la sesión
 * (nunca uno que venga de la petición, regla 1). Un cobrador (autenticado, con negocio) que lo intenta
 * deja un evento `RECHAZADO` con `commandName` como acción (uno por minuto, ADR 0005); el Super Admin
 * no tiene negocio y recibe el 403 sin evento.
 *
 * Los Route Handlers lo llaman **antes** de validar la entrada (un actor sin permiso recibe 403, nunca
 * un 400 que le detalle el formato esperado); los servicios lo vuelven a aplicar.
 */
export async function authorizeBusinessAdmin(
  db: Pick<Pool, "connect">,
  actor: SessionContext,
  commandName: string,
): Promise<string> {
  try {
    authorizeSession(actor, { roles: ["ADMIN_NEGOCIO"] });
  } catch (error) {
    if (actor.businessId && (error as { code?: string }).code === "FORBIDDEN") {
      const businessId = actor.businessId;
      await recordRejectedAttempt(
        db,
        {
          actor,
          businessId,
          action: commandName,
          entityType: "business",
          entityId: businessId,
        },
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
