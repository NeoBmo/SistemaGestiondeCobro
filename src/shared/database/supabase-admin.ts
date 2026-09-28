import { createClient } from "@supabase/supabase-js";
import { getPublicEnv, getServerEnv } from "../validation/env";

/**
 * Cliente con `service_role`: salta RLS. Solo servidor, nunca desde código que llegue al navegador.
 * Sin sesión propia: cada llamada es explícita y el `business_id` lo decide el servicio (regla 1).
 */
export function createSupabaseAdminClient() {
  return createClient(getPublicEnv().supabaseUrl, getServerEnv().supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
