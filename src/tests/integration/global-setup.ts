import pg from "pg";
import { TEST_DATABASE_URL, assertLocalDatabase } from "./helpers/db";

/** Falla rápido y con un mensaje accionable si la base local no está lista. */
export default async function setup() {
  assertLocalDatabase(TEST_DATABASE_URL);
  const client = new pg.Client({
    connectionString: TEST_DATABASE_URL,
    connectionTimeoutMillis: 3000,
  });

  try {
    await client.connect();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `No hay conexión con la base de pruebas local. Levántala con \`npm run db:start\`. Detalle: ${detail}`,
    );
  }

  try {
    const { rows } = await client.query<{ fn: string | null }>(
      "select to_regprocedure('private.make_append_only(regclass,text[])')::text as fn",
    );
    if (!rows[0]?.fn) {
      throw new Error("Migraciones sin aplicar en la base local. Ejecuta `npm run db:migrate`.");
    }
  } finally {
    await client.end();
  }
}
