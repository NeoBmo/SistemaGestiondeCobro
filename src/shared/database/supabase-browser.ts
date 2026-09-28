import { createBrowserClient } from "@supabase/ssr";
import { getPublicEnv } from "../validation/env";

/** Cliente de navegador con la clave anónima. Nunca escribe hechos financieros (regla 9). */
export function createSupabaseBrowserClient() {
  const env = getPublicEnv();
  return createBrowserClient(env.supabaseUrl, env.supabaseAnonKey);
}
