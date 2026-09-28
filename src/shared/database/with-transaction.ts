import type { Pool, PoolClient } from "pg";
import { getPool } from "./pg-pool";

/** Lo único que ve el código de dominio: consultas. No puede abrir/cerrar la transacción ni soltar la conexión. */
export type Tx = Pick<PoolClient, "query">;

/**
 * Ejecuta `fn` en una única transacción: COMMIT si termina, ROLLBACK si lanza (todo o nada).
 * Aislamiento por defecto (READ COMMITTED); los comandos toman sus propios bloqueos (03-ARQUITECTURA §3).
 */
export async function withTransaction<T>(
  fn: (tx: Tx) => Promise<T>,
  pool: Pick<Pool, "connect"> = getPool(),
): Promise<T> {
  const client = await pool.connect();
  const tx: Tx = { query: client.query.bind(client) as Tx["query"] };
  let destroyConnection = false;
  try {
    await client.query("BEGIN");
    const result = await fn(tx);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Estado dudoso: la conexión se destruye en vez de volver al pool. Se conserva el error original.
      destroyConnection = true;
    }
    throw error;
  } finally {
    client.release(destroyConnection || undefined);
  }
}
