import type { SupabaseClient } from "@supabase/supabase-js";
import type { Pool } from "pg";
import { recordAuditEvent } from "@/modules/audit/record-audit-event";
import { authorizeBusinessAdmin } from "@/modules/identity/authorize-business-admin";
import type { SessionContext } from "@/modules/identity/session";
import { syntheticEmail } from "@/modules/identity/synthetic-email";
import { generateTemporaryPassword } from "@/modules/identity/temporary-password";
import { parseUsername } from "@/modules/identity/username";
import { setLockTimeout, translateLockTimeout } from "@/shared/database/lock-timeout";
import { withTransaction, type Tx } from "@/shared/database/with-transaction";
import { AppError } from "@/shared/errors/app-error";
import type { CreateCollectorInput } from "./validation";

/**
 * Cobradores (02 §4.1, ADR 0009). Los administra solo el Admin de negocio; el negocio sale de la sesión.
 * No son comandos financieros (sin clave de idempotencia): una transacción y su auditoría. Auth y la BD no
 * son atómicos (03 §3): al crear, el usuario de Auth se crea antes y se elimina si la transacción falla.
 */

export type CollectorDeps = {
  db: Pick<Pool, "connect" | "query">;
  admin: {
    auth: {
      admin: Pick<SupabaseClient["auth"]["admin"], "createUser" | "deleteUser" | "updateUserById">;
    };
  };
  syntheticEmailDomain: string;
  generatePassword?: () => string;
};

export type CreatedCollector = {
  collectorId: string;
  userId: string;
  username: string;
  /** Se muestra una sola vez a quien crea la cuenta: no se almacena ni se audita. */
  temporaryPassword: string;
};

export type CollectorPasswordResult = {
  collectorId: string;
  username: string;
  temporaryPassword: string;
};

const usernameTaken = () =>
  new AppError("USERNAME_TAKEN", "Ese nombre de usuario ya está en uso. Elige otro", 409);

/** Traduce los rechazos del trigger de BD (tope del plan, ruta activa) a un 409 entendible. */
export function translateCollectorError(error: unknown): unknown {
  const message = (error as { message?: string; code?: string } | null)?.message ?? "";
  if ((error as { code?: string } | null)?.code === "23514") {
    if (message.includes("no admite más cobradores")) {
      return new AppError(
        "COLLECTOR_LIMIT_REACHED",
        "El plan del negocio no admite más cobradores activos",
        409,
      );
    }
    if (message.includes("tiene una ruta activa")) {
      return new AppError(
        "COLLECTOR_HAS_ACTIVE_ROUTE",
        "El cobrador tiene una ruta activa: ciérrala antes de desactivarlo",
        409,
      );
    }
    if (
      message.includes("Solo se asigna a un cobrador ACTIVO") ||
      message.includes("Solo se crea una ruta")
    ) {
      return new AppError("COLLECTOR_INACTIVE", "El cobrador está inactivo", 409);
    }
    if (message.includes("Solo se asigna a una ruta ACTIVA")) {
      return new AppError("ROUTE_CLOSED", "La ruta está cerrada: elige una ruta activa", 409);
    }
    if (message.includes("aún tiene clientes asignados")) {
      return new AppError(
        "ROUTE_HAS_CLIENTS",
        "La ruta aún tiene clientes asignados: reasígnalos antes de cerrarla",
        409,
      );
    }
    if (message.includes("jornada")) {
      return new AppError(
        "COLLECTOR_HAS_OPEN_SESSION",
        "El cobrador tiene una jornada abierta o pendiente de liquidación",
        409,
      );
    }
  }
  return translateLockTimeout(error);
}

export async function createCollector(
  deps: CollectorDeps,
  actor: SessionContext,
  input: CreateCollectorInput,
): Promise<CreatedCollector> {
  const businessId = await authorizeBusinessAdmin(deps.db, actor, "CobradorCreado");
  const username = parseUsername(input.username);
  if (await usernameInUse(deps.db, username)) throw usernameTaken();

  const temporaryPassword = (deps.generatePassword ?? generateTemporaryPassword)();
  const email = syntheticEmail(username, deps.syntheticEmailDomain);
  const created = await deps.admin.auth.admin.createUser({
    email,
    password: temporaryPassword,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    // Bajo concurrencia Auth no responde `email_exists` sino un 500 genérico: se confirma en la tabla.
    if (created.error?.code === "email_exists" || (await authEmailExists(deps.db, email))) {
      throw usernameTaken();
    }
    throw new AppError("AUTH_UNAVAILABLE", "No se pudo crear la cuenta. Intenta de nuevo", 503);
  }
  const userId = created.data.user.id;

  try {
    return await withTransaction(async (tx) => {
      await tx.query(
        `insert into public.profiles (id, business_id, role, username, display_name)
         values ($1, $2, 'COBRADOR', $3, $4)`,
        [userId, businessId, username, input.name],
      );
      const collector = await tx.query<{ id: string }>(
        `insert into public.collectors (business_id, user_id, name, created_by)
         values ($1, $2, $3, $4) returning id`,
        [businessId, userId, input.name, actor.userId],
      );
      const collectorId = collector.rows[0]!.id;
      const audit = { businessId, actorId: actor.userId };
      await recordAuditEvent(tx, {
        ...audit,
        action: "UsuarioCreado",
        entityType: "profile",
        entityId: userId,
        summary: { role: "COBRADOR", username },
      });
      await recordAuditEvent(tx, {
        ...audit,
        action: "CobradorCreado",
        entityType: "collector",
        entityId: collectorId,
        summary: { name: input.name, username },
      });
      return { collectorId, userId, username, temporaryPassword };
    }, deps.db);
  } catch (failure) {
    await removeOrphanAuthUser(deps, userId);
    if (isUniqueViolation(failure, "profiles_username_key")) throw usernameTaken();
    throw translateCollectorError(failure);
  }
}

type LockedCollector = {
  id: string;
  user_id: string;
  name: string;
  status: "ACTIVO" | "INACTIVO";
  username: string;
  profile_status: string;
};

async function lockCollector(
  tx: Tx,
  businessId: string,
  collectorId: string,
): Promise<LockedCollector> {
  const { rows } = await tx.query<LockedCollector>(
    `select c.id, c.user_id, c.name, c.status, p.username, p.status as profile_status
       from public.collectors c join public.profiles p on p.id = c.user_id
      where c.id = $1 and c.business_id = $2 for update of c, p`,
    [collectorId, businessId],
  );
  if (!rows[0]) throw new AppError("COLLECTOR_NOT_FOUND", "El cobrador no existe", 404);
  return rows[0];
}

/** Revoca las sesiones abiertas (mejor esfuerzo con savepoint: Auth ya las revoca al cambiar la contraseña). */
async function revokeSessions(tx: Tx, userId: string): Promise<number | null> {
  await tx.query("savepoint revoke_sessions");
  try {
    const revoked = await tx.query("delete from auth.sessions where user_id = $1", [userId]);
    await tx.query("release savepoint revoke_sessions");
    return revoked.rowCount ?? 0;
  } catch {
    await tx.query("rollback to savepoint revoke_sessions");
    console.error("[collectors] no se pudo borrar auth.sessions; se confía en Auth");
    return null;
  }
}

/*
 * Auth y la BD no son atómicos (03 §3): `setTemporaryPassword` llama a Auth dentro de la transacción; si un
 * paso posterior de la BD falla, se revierte la BD pero la contraseña de Auth ya cambió y queda desconocida
 * para todos (lado seguro): el Admin repite el comando para obtener una nueva.
 */

/**
 * Desactivar = bloquear (ADR 0009): el cobrador queda `INACTIVO`, su cuenta `BLOQUEADA` y sus sesiones
 * revocadas. Se rechaza con una ruta `ACTIVA` o una jornada abierta/pendiente (lo exige la base).
 */
export async function deactivateCollector(
  deps: CollectorDeps,
  actor: SessionContext,
  collectorId: string,
): Promise<{ collectorId: string }> {
  const businessId = await authorizeBusinessAdmin(deps.db, actor, "CobradorDesactivado");
  try {
    return await withTransaction(async (tx) => {
      await setLockTimeout(tx);
      const collector = await lockCollector(tx, businessId, collectorId);
      if (collector.status === "INACTIVO") {
        throw new AppError("COLLECTOR_ALREADY_INACTIVE", "El cobrador ya está inactivo", 409);
      }
      await tx.query("update public.collectors set status = 'INACTIVO' where id = $1", [
        collectorId,
      ]);
      await tx.query(
        "update public.profiles set status = 'BLOQUEADO', updated_at = now() where id = $1",
        [collector.user_id],
      );
      const sessionsRevoked = await revokeSessions(tx, collector.user_id);
      const audit = { businessId, actorId: actor.userId };
      await recordAuditEvent(tx, {
        ...audit,
        action: "CobradorDesactivado",
        entityType: "collector",
        entityId: collectorId,
        summary: { name: collector.name },
      });
      await recordAuditEvent(tx, {
        ...audit,
        action: "UsuarioBloqueado",
        entityType: "profile",
        entityId: collector.user_id,
        summary: { role: "COBRADOR", username: collector.username, sessionsRevoked },
      });
      return { collectorId };
    }, deps.db);
  } catch (error) {
    throw translateCollectorError(error);
  }
}

/**
 * Reactivar desbloquea la cuenta (ADR 0009): el cobrador vuelve a `ACTIVO` (si el plan lo admite) y recibe
 * una contraseña temporal nueva, que debe cambiar al entrar. Auth va dentro de la transacción: si falla,
 * no cambia nada en la base.
 */
export async function reactivateCollector(
  deps: CollectorDeps,
  actor: SessionContext,
  collectorId: string,
): Promise<CollectorPasswordResult> {
  const businessId = await authorizeBusinessAdmin(deps.db, actor, "CobradorReactivado");
  try {
    return await withTransaction(async (tx) => {
      await setLockTimeout(tx);
      const collector = await lockCollector(tx, businessId, collectorId);
      if (collector.status === "ACTIVO") {
        throw new AppError("COLLECTOR_ALREADY_ACTIVE", "El cobrador ya está activo", 409);
      }
      await tx.query("update public.collectors set status = 'ACTIVO' where id = $1", [collectorId]);
      const temporaryPassword = await setTemporaryPassword(deps, tx, collector);
      await recordAuditEvent(tx, {
        businessId,
        actorId: actor.userId,
        action: "CobradorReactivado",
        entityType: "collector",
        entityId: collectorId,
        summary: { name: collector.name },
      });
      return { collectorId, username: collector.username, temporaryPassword };
    }, deps.db);
  } catch (error) {
    throw translateCollectorError(error);
  }
}

/**
 * El Admin restablece la contraseña de un cobrador activo (ADR 0002): contraseña temporal nueva, usuario
 * en `PENDIENTE_CAMBIO_CONTRASENA` y sesiones revocadas. Un cobrador inactivo/bloqueado no se restablece
 * por esta vía: se reactiva (así no se desbloquea por la puerta de atrás).
 */
export async function resetCollectorPassword(
  deps: CollectorDeps,
  actor: SessionContext,
  collectorId: string,
): Promise<CollectorPasswordResult> {
  const businessId = await authorizeBusinessAdmin(deps.db, actor, "ContrasenaRestablecida");
  try {
    return await withTransaction(async (tx) => {
      await setLockTimeout(tx);
      const collector = await lockCollector(tx, businessId, collectorId);
      if (collector.status !== "ACTIVO") {
        throw new AppError(
          "COLLECTOR_INACTIVE",
          "El cobrador está inactivo: reactívalo para darle una contraseña nueva",
          409,
        );
      }
      // Restablecer no desbloquea por la puerta de atrás: un perfil BLOQUEADO se trata aparte.
      if (collector.profile_status === "BLOQUEADO") {
        throw new AppError(
          "USER_BLOCKED",
          "La cuenta está bloqueada: restablecer la contraseña no la desbloquea",
          409,
        );
      }
      const temporaryPassword = await setTemporaryPassword(deps, tx, collector);
      await recordAuditEvent(tx, {
        businessId,
        actorId: actor.userId,
        action: "ContrasenaRestablecida",
        entityType: "profile",
        entityId: collector.user_id,
        summary: { username: collector.username, role: "COBRADOR" },
      });
      return { collectorId, username: collector.username, temporaryPassword };
    }, deps.db);
  } catch (error) {
    throw translateCollectorError(error);
  }
}

async function setTemporaryPassword(
  deps: CollectorDeps,
  tx: Tx,
  collector: LockedCollector,
): Promise<string> {
  const temporaryPassword = (deps.generatePassword ?? generateTemporaryPassword)();
  const { error } = await deps.admin.auth.admin.updateUserById(collector.user_id, {
    password: temporaryPassword,
  });
  if (error) {
    throw new AppError(
      "AUTH_UNAVAILABLE",
      "No se pudo actualizar la contraseña. Intenta de nuevo",
      503,
    );
  }
  await tx.query(
    "update public.profiles set status = 'PENDIENTE_CAMBIO_CONTRASENA', updated_at = now() where id = $1",
    [collector.user_id],
  );
  await revokeSessions(tx, collector.user_id);
  return temporaryPassword;
}

async function usernameInUse(db: Pick<Pool, "query">, username: string): Promise<boolean> {
  const { rowCount } = await db.query("select 1 from public.profiles where username = $1", [
    username,
  ]);
  return (rowCount ?? 0) > 0;
}

async function authEmailExists(db: Pick<Pool, "query">, email: string): Promise<boolean> {
  const { rowCount } = await db.query("select 1 from auth.users where email = $1", [email]);
  return (rowCount ?? 0) > 0;
}

/** Compensación: sin perfil, el usuario de Auth no sirve y además ocuparía el nombre de usuario. */
async function removeOrphanAuthUser(deps: CollectorDeps, userId: string): Promise<void> {
  try {
    const { error } = await deps.admin.auth.admin.deleteUser(userId);
    if (error) throw new Error(error.message);
  } catch {
    console.error("[collectors] no se pudo eliminar el usuario de Auth huérfano:", userId);
  }
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  const candidate = error as { code?: string; constraint?: string } | null;
  return candidate?.code === "23505" && candidate.constraint === constraint;
}
