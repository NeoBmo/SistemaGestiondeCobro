import { execFileSync } from "node:child_process";

export type LocalSupabase = { url: string; anonKey: string; serviceRoleKey: string };

/**
 * URL y claves del Supabase local (`npm run db:start`), o `null` si no está corriendo. Son las claves
 * públicas de demostración de Supabase local, no secretos. Con `required` falla en vez de devolver
 * `null`: en CI un Supabase caído no debe convertir los recorridos con sesión real en «omitidos».
 */
export function readLocalSupabase({ required }: { required: boolean }): LocalSupabase | null {
  let output: string;
  try {
    output = execFileSync("npx", ["supabase", "status", "-o", "env"], {
      encoding: "utf8",
      shell: true,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 60_000,
    });
  } catch {
    if (required) {
      throw new Error("E2E_REQUIRE_SUPABASE=1 pero `supabase status` falló: ¿corre `db:start`?");
    }
    return null;
  }

  const values = new Map<string, string>();
  for (const line of output.split("\n")) {
    const match = /^([A-Z_]+)="(.*)"$/.exec(line.trim());
    if (match?.[1] && match[2] !== undefined) values.set(match[1], match[2]);
  }
  const url = values.get("API_URL");
  const anonKey = values.get("ANON_KEY");
  const serviceRoleKey = values.get("SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceRoleKey) {
    if (required)
      throw new Error("`supabase status` no devolvió API_URL, ANON_KEY y SERVICE_ROLE_KEY.");
    return null;
  }
  return { url, anonKey, serviceRoleKey };
}
