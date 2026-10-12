import type { Pool } from "pg";
import { recordRejectedAttempt } from "@/modules/audit/record-rejection";
import { isAppError } from "@/shared/errors/app-error";
import { authorizeSession, type SessionContext } from "./session";

/**
 * Exige un Super Admin activo (sin contraseña temporal pendiente) para un comando sobre un negocio.
 *
 * Si el actor está autenticado pero no tiene permiso sobre un negocio que existe, deja un evento
 * `RECHAZADO` (ADR 0005) antes de devolver 403. Si el negocio no existe no hay entidad que auditar y la
 * respuesta es la misma 403, para no revelar qué negocios existen. Para que un usuario autenticado no
 * pueda inundar la auditoría repitiendo el intento, se deja un solo evento por actor, acción y negocio
 * por minuto. Auditar el rechazo es de mejor esfuerzo: nunca tapa el 403.
 *
 * `auditAction` es el evento que se habría generado si el comando se hubiera aplicado.
 */
export async function authorizeSuperAdminOnBusiness(
  db: Pick<Pool, "connect">,
  actor: SessionContext,
  auditAction: string,
  businessId: string,
): Promise<void> {
  try {
    authorizeSession(actor, { roles: ["SUPER_ADMIN"] });
  } catch (error) {
    if (isAppError(error) && error.code === "FORBIDDEN") {
      await recordRejection(db, actor, auditAction, businessId);
    }
    throw error;
  }
}

async function recordRejection(
  db: Pick<Pool, "connect">,
  actor: SessionContext,
  auditAction: string,
  businessId: string,
): Promise<void> {
  await recordRejectedAttempt(
    db,
    { actor, businessId, action: auditAction, entityType: "business", entityId: businessId },
    async (tx) =>
      ((await tx.query("select 1 from public.businesses where id = $1", [businessId])).rowCount ??
        0) > 0,
  );
}
