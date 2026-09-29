import type { SupabaseClient } from "@supabase/supabase-js";
import type { Pool } from "pg";
import { recordAuditEvent } from "@/modules/audit/record-audit-event";
import { withTransaction } from "@/shared/database/with-transaction";
import { AppError } from "@/shared/errors/app-error";
import { assertValidPassword } from "./password-policy";
import type { SessionContext } from "./session";

export type PasswordDeps = {
  /** Cliente ligado a la sesión del propio usuario: `updateUser` actúa sobre esa sesión. */
  supabase: { auth: Pick<SupabaseClient["auth"], "updateUser" | "signOut"> };
  db: Pick<Pool, "connect" | "query">;
};

const notPending = () =>
  new AppError("PASSWORD_CHANGE_NOT_PENDING", "Tu contraseña temporal ya fue cambiada", 409);

/**
 * Cambio obligatorio de la contraseña temporal en el primer acceso (02 §1.4): valida la política,
 * la cambia en Auth y deja el usuario ACTIVO con su auditoría, una sola vez aunque lleguen dos
 * peticiones a la vez. Al terminar cierra las demás sesiones abiertas con la contraseña temporal.
 *
 * Auth y la BD no son atómicos entre sí. Si la transacción de BD falla después de cambiar la
 * contraseña, el usuario sigue PENDIENTE con la contraseña nueva: debe elegir otra distinta de la
 * actual, porque Auth rechaza repetirla (SAME_PASSWORD). Es un caso raro y no deja acceso indebido.
 */
export async function completeFirstPasswordChange(
  deps: PasswordDeps,
  context: SessionContext,
  newPassword: string,
): Promise<void> {
  if (!context.mustChangePassword) throw notPending();
  assertValidPassword(newPassword);

  const { error } = await deps.supabase.auth.updateUser({ password: newPassword });
  if (error) {
    if (error.code === "same_password") {
      throw new AppError("SAME_PASSWORD", "La nueva contraseña debe ser distinta de la actual");
    }
    if (error.code === "weak_password") {
      throw new AppError("INVALID_PASSWORD", "La contraseña no cumple la política de seguridad");
    }
    throw new AppError(
      "AUTH_UNAVAILABLE",
      "No se pudo cambiar la contraseña. Intenta de nuevo",
      503,
    );
  }

  await withTransaction(async (tx) => {
    const updated = await tx.query(
      "update public.profiles set status = 'ACTIVO', updated_at = now() where id = $1 and status = 'PENDIENTE_CAMBIO_CONTRASENA'",
      [context.userId],
    );
    // Otra petición concurrente ya completó el cambio: no se duplica la auditoría.
    if (updated.rowCount === 0) throw notPending();

    for (const action of ["ContrasenaCambiada", "PrimerAccesoCompletado"]) {
      await recordAuditEvent(tx, {
        businessId: context.businessId,
        actorId: context.userId,
        action,
        entityType: "profile",
        entityId: context.userId,
      });
    }
  }, deps.db);

  // Mejor esfuerzo: la contraseña temporal pudo usarse en otros dispositivos.
  await deps.supabase.auth.signOut({ scope: "others" });
}
