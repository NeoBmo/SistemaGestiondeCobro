import { execFileSync } from "node:child_process";
import pg from "pg";
import { TEST_DATABASE_URL, assertLocalDatabase } from "./helpers/db";

/** Deja en process.env la URL y las claves del Supabase local para las pruebas que usan Auth. */
function loadSupabaseEnv(): void {
  const names = {
    TEST_SUPABASE_URL: "API_URL",
    TEST_SUPABASE_ANON_KEY: "ANON_KEY",
    TEST_SUPABASE_SERVICE_ROLE_KEY: "SERVICE_ROLE_KEY",
  } as const;
  if (Object.keys(names).every((name) => process.env[name])) return;

  let output: string;
  try {
    output = execFileSync("npx", ["supabase", "status", "-o", "env"], {
      encoding: "utf8",
      shell: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    throw new Error("No se pudo leer `supabase status`. ¿Está corriendo `npm run db:start`?");
  }

  const values = new Map<string, string>();
  for (const line of output.split("\n")) {
    const match = /^([A-Z_]+)="(.*)"$/.exec(line.trim());
    if (match?.[1] && match[2] !== undefined) values.set(match[1], match[2]);
  }
  for (const [envName, statusName] of Object.entries(names)) {
    const value = values.get(statusName);
    if (!value) throw new Error(`\`supabase status\` no devolvió ${statusName}.`);
    process.env[envName] ??= value;
  }
}

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

  loadSupabaseEnv();
}
