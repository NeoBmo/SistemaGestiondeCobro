import { Pool } from "pg";
import { getServerEnv } from "../validation/env";

/**
 * Pool `pg` sobre el pooler de Supabase (ADR 0001). Un único pool por proceso, también entre
 * recargas de desarrollo. Solo servidor. Las transacciones usan bloqueos `*_xact_*`, compatibles
 * con el modo transaction del pooler.
 */
const globalForPool = globalThis as unknown as { __cuadrePgPool?: Pool };

export function getPool(): Pool {
  if (!globalForPool.__cuadrePgPool) {
    const pool = new Pool({
      connectionString: getServerEnv().databaseUrl,
      max: 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
    });
    pool.on("error", (error) => {
      console.error("[pg] error en una conexión inactiva:", error.message);
    });
    globalForPool.__cuadrePgPool = pool;
  }
  return globalForPool.__cuadrePgPool;
}
