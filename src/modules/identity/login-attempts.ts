import type { Pool } from "pg";
import { withTransaction, type Tx } from "@/shared/database/with-transaction";
import { AppError } from "@/shared/errors/app-error";

/**
 * Límite de intentos de login en la aplicación (02-DOMINIO §1.4, decisión del 2026-10-24). Supabase Auth
 * ve la IP del servidor, así que su propio límite es global: si se dejara a él, un atacante bloquearía el
 * login de todos. Aquí: 5 fallos seguidos de un usuario en 15 minutos lo bloquean 15 minutos; más de 30
 * fallos desde una IP en 15 minutos la bloquean 15 minutos. Un login exitoso reinicia el contador del usuario.
 */
export const LOGIN_LIMITS = {
  userFailures: 5,
  ipFailures: 31,
  windowMinutes: 15,
  lockMinutes: 15,
  retentionDays: 90,
} as const;

export type LoginAttemptResult =
  | "EXITOSO"
  | "CREDENCIALES_INVALIDAS"
  | "USUARIO_BLOQUEADO_TEMPORALMENTE"
  | "IP_BLOQUEADA_TEMPORALMENTE"
  | "CUENTA_BLOQUEADA"
  | "NEGOCIO_SUSPENDIDO"
  | "ACCESO_DENEGADO"
  | "LIMITE_AUTH"
  | "AUTH_NO_DISPONIBLE"
  | "ERROR_INTERNO";

/** Mismo mensaje para usuario e IP, exista o no el usuario: no revela nada salvo que hay que esperar. */
export const tooManyAttempts = () =>
  new AppError(
    "TOO_MANY_ATTEMPTS",
    `Demasiados intentos fallidos. Espera ${LOGIN_LIMITS.lockMinutes} minutos e intenta de nuevo`,
    429,
  );

// Espacios de los bloqueos consultivos de dos claves (no chocan con los de una clave de las cajas).
const USER_LOCK_SPACE = 1_402;
const IP_LOCK_SPACE = 1_403;

/**
 * Hora hasta la que la clave está bloqueada, o `null`. Cuentan los intentos `EN_CURSO` (aún sin resultado,
 * pesimista) y los de contraseña incorrecta. El bloqueo empieza en el fallo que completa el umbral dentro de
 * la ventana y dura `lockMinutes` desde ahí; las peticiones rechazadas por el bloqueo no lo alargan.
 */
async function lockedUntil(
  tx: Tx,
  key: { column: "username" | "ip"; value: string; threshold: number; resetOnSuccess: boolean },
  now: Date,
): Promise<Date | null> {
  // Solo el usuario se reinicia con un éxito; la IP no (02 §1.4).
  const sinceLastSuccess = key.resetOnSuccess
    ? `and occurred_at > coalesce(
         (select max(occurred_at) from public.login_security_events
           where username = $1 and result = 'EXITOSO'),
         '-infinity')`
    : "";
  const { rows } = await tx.query<{ locked_until: Date | null }>(
    `with counted as (
       select occurred_at, lag(occurred_at, $3::int) over (order by occurred_at) as earliest
         from public.login_security_events
        where ${key.column} = $1::${key.column === "ip" ? "inet" : "text"}
          and result in ('EN_CURSO', 'CREDENCIALES_INVALIDAS')
          and occurred_at > $2::timestamptz - make_interval(mins => $4::int + $5::int)
          ${sinceLastSuccess}
     )
     select max(occurred_at) + make_interval(mins => $5) as locked_until
       from counted
      where earliest >= occurred_at - make_interval(mins => $4)`,
    [key.value, now, key.threshold - 1, LOGIN_LIMITS.windowMinutes, LOGIN_LIMITS.lockMinutes],
  );
  const until = rows[0]?.locked_until ?? null;
  return until && until > now ? until : null;
}

/**
 * Registra el intento ANTES de llamar a Supabase Auth y decide si está bloqueado. Los bloqueos consultivos
 * (usuario y luego IP, siempre en ese orden: sin interbloqueos) serializan solo esta comprobación, no la
 * llamada a Auth: así no se retiene una conexión del pool durante una petición HTTP, y aun así dos peticiones
 * simultáneas no superan el límite porque la primera deja su fila `EN_CURSO` antes de soltar el bloqueo.
 * Devuelve el id del intento; si la clave está bloqueada deja el evento y lanza `TOO_MANY_ATTEMPTS`.
 */
export async function reserveLoginAttempt(
  db: Pick<Pool, "connect">,
  attempt: { username: string; ip: string | null; now: Date },
): Promise<string> {
  const username = attempt.username.slice(0, 64);
  const { id, blocked } = await withTransaction(async (tx) => {
    await tx.query("select pg_advisory_xact_lock($1, hashtext($2))", [USER_LOCK_SPACE, username]);
    if (attempt.ip) {
      await tx.query("select pg_advisory_xact_lock($1, hashtext($2::inet::text))", [
        IP_LOCK_SPACE,
        attempt.ip,
      ]);
    }

    let result: "EN_CURSO" | LoginAttemptResult = "EN_CURSO";
    const userKey = {
      column: "username",
      value: username,
      threshold: LOGIN_LIMITS.userFailures,
      resetOnSuccess: true,
    } as const;
    if (await lockedUntil(tx, userKey, attempt.now)) {
      result = "USUARIO_BLOQUEADO_TEMPORALMENTE";
    } else if (attempt.ip) {
      const ipKey = {
        column: "ip",
        value: attempt.ip,
        threshold: LOGIN_LIMITS.ipFailures,
        resetOnSuccess: false,
      } as const;
      if (await lockedUntil(tx, ipKey, attempt.now)) result = "IP_BLOQUEADA_TEMPORALMENTE";
    }

    const { rows } = await tx.query<{ id: string }>(
      `insert into public.login_security_events (username, ip, result, occurred_at)
       values ($1, $2::inet, $3, $4) returning id`,
      [username, attempt.ip, result, attempt.now],
    );
    return { id: rows[0]!.id, blocked: result !== "EN_CURSO" };
  }, db);

  if (blocked) throw tooManyAttempts();
  return id;
}

/** Cierra un intento `EN_CURSO` con su resultado. Un `EXITOSO` reinicia el contador del usuario. */
export async function closeLoginAttempt(
  db: Pick<Pool, "query"> | Tx,
  attemptId: string,
  result: LoginAttemptResult,
): Promise<void> {
  await db.query(
    "update public.login_security_events set result = $2 where id = $1 and result = 'EN_CURSO'",
    [attemptId, result],
  );
}

/**
 * Retención de 90 días: suficiente para investigar un ataque o un reclamo de un trimestre, y no más, porque
 * usuario e IP son datos personales (Ley 1581, minimización). Se purga por lotes al iniciar sesión con éxito
 * (no hay tareas programadas en V1); la base de datos rechaza borrar eventos más recientes.
 */
export async function purgeExpiredLoginEvents(db: Pick<Pool, "query">): Promise<void> {
  await db.query(
    `delete from public.login_security_events
      where id in (select id from public.login_security_events
                    where occurred_at < now() - make_interval(days => $1)
                    order by occurred_at
                    limit 500)`,
    [LOGIN_LIMITS.retentionDays],
  );
}

/** Motivo del fallo para el evento de seguridad, a partir del error que recibe el cliente. */
export function attemptResultOf(error: unknown): LoginAttemptResult {
  if (!(error instanceof AppError)) return "ERROR_INTERNO";
  switch (error.code) {
    case "INVALID_CREDENTIALS":
      return "CREDENCIALES_INVALIDAS";
    case "USER_BLOCKED":
      return "CUENTA_BLOQUEADA";
    case "BUSINESS_SUSPENDED":
      return "NEGOCIO_SUSPENDIDO";
    case "ACCESS_DENIED":
      return "ACCESO_DENEGADO";
    case "TOO_MANY_ATTEMPTS":
      return "LIMITE_AUTH";
    case "AUTH_UNAVAILABLE":
      return "AUTH_NO_DISPONIBLE";
    default:
      return "ERROR_INTERNO";
  }
}
