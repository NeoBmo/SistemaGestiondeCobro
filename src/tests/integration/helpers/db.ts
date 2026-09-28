import pg from "pg";

const { Pool, DatabaseError } = pg;

// Credenciales públicas por defecto de Supabase local (ver .env.example); no son un secreto.
const DEFAULT_TEST_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;

/** Estas pruebas crean y borran tablas: jamás deben correr contra una base que no sea local. */
export function assertLocalDatabase(url: string): void {
  const { hostname } = new URL(url);
  if (!LOCAL_HOSTS.has(hostname)) {
    throw new Error(
      `Las pruebas de integración solo corren contra una base local (127.0.0.1/localhost); llegó "${hostname}".`,
    );
  }
}

export function createTestPool(): pg.Pool {
  assertLocalDatabase(TEST_DATABASE_URL);
  return new Pool({ connectionString: TEST_DATABASE_URL, max: 5 });
}

/** Cliente conectado como otro rol de Postgres (misma contraseña local), p. ej. `supabase_auth_admin`. */
export function createRoleClient(role: string): pg.Client {
  assertLocalDatabase(TEST_DATABASE_URL);
  const url = new URL(TEST_DATABASE_URL);
  url.username = role;
  return new pg.Client({ connectionString: url.toString() });
}

/** Ejecuta `fn` en una transacción que siempre se revierte: el DDL de prueba no deja rastro. */
export async function withRollback<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    return await fn(client);
  } finally {
    try {
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  }
}

/**
 * Ejecuta una sentencia que se espera que falle sin abortar la transacción de la prueba
 * (usa un savepoint). Devuelve el error de PostgreSQL, o `null` si tuvo éxito.
 */
export async function attempt(
  client: pg.PoolClient,
  text: string,
  values?: unknown[],
): Promise<pg.DatabaseError | null> {
  await client.query("SAVEPOINT attempt");
  try {
    await client.query(text, values);
    await client.query("RELEASE SAVEPOINT attempt");
    return null;
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT attempt");
    if (error instanceof DatabaseError) return error;
    throw error;
  }
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
