import type { SupabaseClient } from "@supabase/supabase-js";
import type { Pool } from "pg";
import { recordAuditEvent } from "@/modules/audit/record-audit-event";
import { withTransaction } from "@/shared/database/with-transaction";
import { AppError } from "@/shared/errors/app-error";
import {
  attemptResultOf,
  closeLoginAttempt,
  purgeExpiredLoginEvents,
  reserveLoginAttempt,
} from "./login-attempts";
import { loadSessionContext, type Role } from "./session";
import { syntheticEmail } from "./synthetic-email";
import { isValidUsername, normalizeUsername } from "./username";

export type LoginDeps = {
  supabase: { auth: Pick<SupabaseClient["auth"], "signInWithPassword" | "signOut"> };
  db: Pick<Pool, "connect" | "query">;
  syntheticEmailDomain: string;
  /** Reloj inyectable (pruebas del límite de intentos). */
  now?: () => Date;
};

export type LoginInput = {
  username: string;
  password: string;
  /** IP del cliente según la plataforma (`clientIp`); `null` si no es fiable: entonces no hay límite por IP. */
  ip?: string | null;
};

export type LoginResult = { userId: string; role: Role; mustChangePassword: boolean };

const invalidCredentials = () =>
  new AppError("INVALID_CREDENTIALS", "Usuario o contraseña incorrectos", 401);

/**
 * Inicia sesión con usuario y contraseña (ADR 0002). Supabase Auth guarda la sesión en las cookies
 * del cliente recibido. Un usuario inexistente y una contraseña errónea dan exactamente el mismo error.
 * Si algo falla después de autenticar, la sesión recién creada se cierra (todo o nada).
 *
 * Antes de llamar a Auth se registra el intento y se aplica el límite de intentos (02 §1.4); cada intento
 * termina como evento de seguridad con su resultado, nunca con la contraseña.
 */
export async function signInWithUsername(deps: LoginDeps, input: LoginInput): Promise<LoginResult> {
  const username = normalizeUsername(input.username);
  const attemptId = await reserveLoginAttempt(deps.db, {
    username,
    ip: input.ip ?? null,
    now: deps.now?.() ?? new Date(),
  });

  let result: LoginResult;
  try {
    result = await authenticate(deps, username, input.password, attemptId);
  } catch (failure) {
    try {
      await closeLoginAttempt(deps.db, attemptId, attemptResultOf(failure));
    } catch {
      // El intento queda EN_CURSO y sigue contando como fallo (lado seguro). Se conserva el error original.
      console.error("[login] no se pudo cerrar el evento de seguridad");
    }
    throw failure;
  }

  try {
    await purgeExpiredLoginEvents(deps.db);
  } catch {
    // La retención es de mejor esfuerzo: nunca impide un inicio de sesión válido.
    console.error("[login] no se pudo purgar eventos de seguridad vencidos");
  }
  return result;
}

async function authenticate(
  deps: LoginDeps,
  username: string,
  password: string,
  attemptId: string,
): Promise<LoginResult> {
  if (!isValidUsername(username) || password.length === 0) throw invalidCredentials();

  const { data, error } = await deps.supabase.auth.signInWithPassword({
    email: syntheticEmail(username, deps.syntheticEmailDomain),
    password,
  });

  if (error || !data.user) {
    if (error?.status === 403) throw await explainDeniedAccess(deps, username);
    if (error?.status === 429) {
      throw new AppError(
        "TOO_MANY_ATTEMPTS",
        "Demasiados intentos. Espera unos minutos e intenta de nuevo",
        429,
      );
    }
    if (!error?.status || error.status >= 500) {
      throw new AppError("AUTH_UNAVAILABLE", "No se pudo iniciar sesión. Intenta de nuevo", 503);
    }
    throw invalidCredentials();
  }

  const userId = data.user.id;
  try {
    const context = await loadSessionContext(userId, deps.db);
    await withTransaction(async (tx) => {
      await tx.query("update public.profiles set last_sign_in_at = now() where id = $1", [userId]);
      // En la misma transacción que InicioSesion: el contador del usuario se reinicia solo si el login cuajó.
      await closeLoginAttempt(tx, attemptId, "EXITOSO");
      await recordAuditEvent(tx, {
        businessId: context.businessId,
        actorId: userId,
        action: "InicioSesion",
        entityType: "profile",
        entityId: userId,
      });
    }, deps.db);
    return { userId, role: context.role, mustChangePassword: context.mustChangePassword };
  } catch (failure) {
    // Solo esta sesión: no se cierran las de otros dispositivos del mismo usuario.
    await deps.supabase.auth.signOut({ scope: "local" });
    throw failure;
  }
}

/**
 * El hook de Auth solo rechaza (403) después de validar la contraseña, así que aquí las credenciales
 * ya son correctas y es seguro explicar el motivo (usuario bloqueado o negocio suspendido).
 */
async function explainDeniedAccess(deps: LoginDeps, username: string): Promise<AppError> {
  const { rows } = await deps.db.query<{ id: string }>(
    "select id from public.profiles where username = $1",
    [username],
  );
  const profileId = rows[0]?.id;
  if (profileId) {
    try {
      await loadSessionContext(profileId, deps.db);
    } catch (reason) {
      if (reason instanceof AppError) return reason;
      throw reason;
    }
  }
  return new AppError("ACCESS_DENIED", "Tu cuenta no tiene acceso a la aplicación", 403);
}
