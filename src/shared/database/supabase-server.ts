import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getPublicEnv } from "../validation/env";

/**
 * Cliente de servidor ligado a la sesión (cookies) del usuario; respeta RLS. Todo el acceso a
 * Auth pasa por Route Handlers (no hay cliente de Supabase en el navegador), así que las cookies
 * son `httpOnly`: un XSS no puede leer el token de sesión.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const env = getPublicEnv();

  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Un Server Component no puede escribir cookies. El refresco de la sesión se hará en el
          // proxy de Next (F1-T5, junto con las páginas de login).
        }
      },
    },
  });
}
