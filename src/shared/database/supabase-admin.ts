import { createClient } from "@supabase/supabase-js";
import { getPublicEnv, getServerEnv } from "../validation/env";

/** Tope de cada llamada HTTP a Auth: un Auth lento no debe retener transacciones ni conexiones del pool. */
export const AUTH_REQUEST_TIMEOUT_MS = 10_000;

/** `fetch` con tope de tiempo; respeta la señal que ya traiga la petición. */
export function fetchWithTimeout(timeoutMs: number, baseFetch: typeof fetch = fetch): typeof fetch {
  return (input, init) =>
    baseFetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(timeoutMs) });
}

/**
 * Cliente con `service_role`: salta RLS. Solo servidor, nunca desde código que llegue al navegador.
 * Sin sesión propia: cada llamada es explícita y el `business_id` lo decide el servicio (regla 1).
 */
export function createSupabaseAdminClient() {
  return createClient(getPublicEnv().supabaseUrl, getServerEnv().supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: fetchWithTimeout(AUTH_REQUEST_TIMEOUT_MS) },
  });
}
