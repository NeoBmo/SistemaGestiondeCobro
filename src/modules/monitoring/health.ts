import { timingSafeEqual } from "node:crypto";
import type { Pool } from "pg";

/**
 * Chequeo de disponibilidad (ADR 0011). Un servicio externo (p. ej. un cron) lo invoca con un secreto: se
 * verifica la base y la autenticación, y se guarda el resultado con su latencia. Si la base no responde no se
 * puede escribir: esa interrupción se ve como la **ausencia** de chequeos recientes en el panel.
 */

export type HealthResult = {
  ok: boolean;
  databaseOk: boolean;
  authOk: boolean;
  latencyMs: number;
};

/** Compara el secreto en tiempo constante; sin secreto configurado el chequeo está deshabilitado. */
export function isValidMonitorSecret(
  provided: string | null,
  expected: string | undefined,
): boolean {
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type HealthDeps = {
  db: Pick<Pool, "query">;
  /** Comprueba el servicio de autenticación; por defecto, el endpoint de salud de Supabase Auth. */
  checkAuth: () => Promise<boolean>;
  now?: () => number;
};

export async function authHealth(supabaseUrl: string, timeoutMs = 3000): Promise<boolean> {
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function runHealthCheck(deps: HealthDeps): Promise<HealthResult> {
  const now = deps.now ?? (() => performance.now());
  const start = now();
  let databaseOk = true;
  try {
    await deps.db.query("select 1");
  } catch {
    databaseOk = false;
  }
  const authOk = await deps.checkAuth().catch(() => false);
  const latencyMs = Math.max(0, Math.round(now() - start));
  const result: HealthResult = { ok: databaseOk && authOk, databaseOk, authOk, latencyMs };
  // Con la base caída no hay dónde escribir: el panel lo ve como falta de chequeos.
  if (databaseOk) {
    await deps.db.query(
      "insert into public.health_checks (ok, database_ok, auth_ok, latency_ms) values ($1, $2, $3, $4)",
      [result.ok, result.databaseOk, result.authOk, result.latencyMs],
    );
  }
  return result;
}
