import type { SupabaseClient } from "@supabase/supabase-js";
import type { Pool } from "pg";
import { recordAuditEvent } from "@/modules/audit/record-audit-event";
import { setLockTimeout, translateLockTimeout } from "@/shared/database/lock-timeout";
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
 * Todo ocurre en una transacción que **bloquea el perfil antes de llamar a Auth**, igual que el
 * restablecimiento de contraseña del Super Admin: así ambos se serializan y un cambio obligatorio no
 * puede dejar ACTIVA una cuenta a la que el Super Admin acaba de dar una contraseña temporal.
 *
 * Auth y la BD no son atómicos entre sí. Si un paso de la BD falla después de cambiar la contraseña, la
 * BD se revierte y el usuario sigue PENDIENTE con la contraseña nueva: debe elegir otra distinta de la
 * actual, porque Auth rechaza repetirla (SAME_PASSWORD). Es un caso raro y no deja acceso indebido.
 */
export async function completeFirstPasswordChange(
  deps: PasswordDeps,
  context: SessionContext,
  newPassword: string,
): Promise<void> {
  if (!context.mustChangePassword) throw notPending();
  assertValidPassword(newPassword);

  try {
    await withTransaction(async (tx) => {
      await setLockTimeout(tx);
      const profile = await tx.query<{ status: string }>(
        "select status from public.profiles where id = $1 for update",
        [context.userId],
      );
      // Otra petición (o un restablecimiento) ya cambió el estado: no se duplica nada.
      if (profile.rows[0]?.status !== "PENDIENTE_CAMBIO_CONTRASENA") throw notPending();

      const { error } = await deps.supabase.auth.updateUser({ password: newPassword });
      if (error) {
        if (error.code === "same_password") {
          throw new AppError("SAME_PASSWORD", "La nueva contraseña debe ser distinta de la actual");
        }
        if (error.code === "weak_password") {
          throw new AppError(
            "INVALID_PASSWORD",
            "La contraseña no cumple la política de seguridad",
          );
        }
        throw new AppError(
          "AUTH_UNAVAILABLE",
          "No se pudo cambiar la contraseña. Intenta de nuevo",
          503,
        );
      }

      await tx.query(
        "update public.profiles set status = 'ACTIVO', updated_at = now() where id = $1",
        [context.userId],
      );
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
  } catch (error) {
    throw translateLockTimeout(error);
  }

  // Mejor esfuerzo: la contraseña temporal pudo usarse en otros dispositivos.
  await deps.supabase.auth.signOut({ scope: "others" });
}
