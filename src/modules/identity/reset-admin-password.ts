import type { SupabaseClient } from "@supabase/supabase-js";
import type { Pool } from "pg";
import { recordAuditEvent } from "@/modules/audit/record-audit-event";
import { setLockTimeout, translateLockTimeout } from "@/shared/database/lock-timeout";
import { withTransaction } from "@/shared/database/with-transaction";
import { AppError } from "@/shared/errors/app-error";
import { authorizeSuperAdminOnBusiness } from "./authorize-super-admin";
import type { SessionContext } from "./session";
import { generateTemporaryPassword } from "./temporary-password";

export type ResetAdminPasswordDeps = {
  db: Pick<Pool, "connect" | "query">;
  admin: { auth: { admin: Pick<SupabaseClient["auth"]["admin"], "updateUserById"> } };
  generatePassword?: () => string;
};

export type ResetAdminPasswordResult = {
  businessId: string;
  admin: { userId: string; username: string };
  /** Se muestra una sola vez a quien restablece: no se almacena ni se audita. */
  temporaryPassword: string;
};

/**
 * El Super Admin restablece la contraseña del admin de un negocio (02-DOMINIO §1.4, ADR 0005): deja una
 * contraseña temporal nueva, el usuario en PENDIENTE_CAMBIO_CONTRASENA, le revoca todas las sesiones
 * activas y audita `ContrasenaRestablecida`. El objetivo sale del negocio (un negocio tiene una sola
 * cuenta admin en V1), nunca de un id enviado por el cliente. Se permite con el negocio suspendido o
 * archivado: es justo el caso del cambio de titular.
 *
 * Auth y la BD no son atómicos (03 §3). Todo ocurre dentro de una transacción que bloquea el perfil
 * (así dos restablecimientos simultáneos no se pisan y la contraseña devuelta es la vigente): si Auth
 * falla no cambia nada; si falla un paso posterior de la BD se revierte la BD pero la contraseña de
 * Auth ya cambió — queda **desconocida para todos** (la anterior deja de servir), que es el lado
 * seguro, y el Super Admin repite el comando para obtener una nueva.
 */
export async function resetAdminPassword(
  deps: ResetAdminPasswordDeps,
  actor: SessionContext,
  input: { businessId: string },
): Promise<ResetAdminPasswordResult> {
  await authorizeSuperAdminOnBusiness(deps.db, actor, "ContrasenaRestablecida", input.businessId);

  try {
    return await runReset(deps, actor, input);
  } catch (error) {
    throw translateLockTimeout(error);
  }
}

async function runReset(
  deps: ResetAdminPasswordDeps,
  actor: SessionContext,
  input: { businessId: string },
): Promise<ResetAdminPasswordResult> {
  return withTransaction(async (tx) => {
    await setLockTimeout(tx);
    const business = await tx.query("select 1 from public.businesses where id = $1", [
      input.businessId,
    ]);
    if ((business.rowCount ?? 0) === 0) {
      throw new AppError("BUSINESS_NOT_FOUND", "El negocio no existe", 404);
    }

    const profile = await tx.query<{ id: string; username: string; status: string }>(
      `select id, username, status from public.profiles
        where business_id = $1 and role = 'ADMIN_NEGOCIO' for update`,
      [input.businessId],
    );
    const target = profile.rows[0];
    if (!target) {
      throw new AppError("ADMIN_NOT_FOUND", "El negocio no tiene una cuenta administradora", 404);
    }
    // Restablecer deja al usuario PENDIENTE: no puede ser la vía para desbloquear a un BLOQUEADO.
    if (target.status === "BLOQUEADO") {
      throw new AppError(
        "USER_BLOCKED",
        "La cuenta está bloqueada: restablecer la contraseña no la desbloquea",
        409,
      );
    }

    const temporaryPassword = (deps.generatePassword ?? generateTemporaryPassword)();
    const { error } = await deps.admin.auth.admin.updateUserById(target.id, {
      password: temporaryPassword,
    });
    if (error) {
      throw new AppError(
        "AUTH_UNAVAILABLE",
        "No se pudo restablecer la contraseña. Intenta de nuevo",
        503,
      );
    }

    await tx.query(
      "update public.profiles set status = 'PENDIENTE_CAMBIO_CONTRASENA', updated_at = now() where id = $1",
      [target.id],
    );
    // Auth (GoTrue) ya revoca las sesiones al cambiar la contraseña por su API de administración, pero
    // eso es comportamiento de la versión de Auth: se garantiza aquí también. Es la misma base de datos
    // que Auth, así que borrar las sesiones (sus refresh tokens caen en cascada) es atómico con el resto
    // y deja inservibles los tokens que el admin anterior tuviera abiertos.
    // Mejor esfuerzo con savepoint: si el rol no pudiera borrar de auth.sessions (p. ej. permisos del
    // proyecto alojado), la operación sigue, porque Auth ya revocó las sesiones al cambiar la contraseña.
    let sessionsRevoked: number | null = null;
    await tx.query("savepoint revoke_sessions");
    try {
      const revoked = await tx.query("delete from auth.sessions where user_id = $1", [target.id]);
      sessionsRevoked = revoked.rowCount ?? 0;
      await tx.query("release savepoint revoke_sessions");
    } catch {
      await tx.query("rollback to savepoint revoke_sessions");
      console.error("[reset-admin-password] no se pudo borrar auth.sessions; se confía en Auth");
    }

    await recordAuditEvent(tx, {
      businessId: input.businessId,
      actorId: actor.userId,
      action: "ContrasenaRestablecida",
      entityType: "profile",
      entityId: target.id,
      summary: {
        username: target.username,
        role: "ADMIN_NEGOCIO",
        previousStatus: target.status,
        sessionsRevoked,
      },
    });

    return {
      businessId: input.businessId,
      admin: { userId: target.id, username: target.username },
      temporaryPassword,
    };
  }, deps.db);
}
