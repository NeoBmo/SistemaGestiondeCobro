import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getPublicEnv } from "../validation/env";
import { sessionCookieOptions } from "./supabase-cookie-options";

/**
 * Cliente de servidor ligado a la sesión (cookies) del usuario; respeta RLS. Todo el acceso a
 * Auth pasa por Route Handlers y Server Components (no hay cliente de Supabase en el navegador).
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const env = getPublicEnv();

  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookieOptions: sessionCookieOptions(),
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Un Server Component no puede escribir cookies: el refresco de la sesión lo hace el proxy
          // (src/proxy.ts) antes de renderizar.
        }
      },
    },
  });
}
