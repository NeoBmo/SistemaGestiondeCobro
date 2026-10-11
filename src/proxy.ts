import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { sessionCookieOptions } from "@/shared/database/supabase-cookie-options";
import { getPublicEnv } from "@/shared/validation/env";

/**
 * Refresca la sesión de Supabase antes de renderizar (ya no puede hacerlo un Server Component, que no
 * escribe cookies). `getClaims()` valida el JWT y, si el token de acceso caducó, lo renueva con el
 * refresh token y deja las cookies nuevas en la petición y en la respuesta. **No decide acceso**: eso lo
 * hace cada página y cada comando contra la BD (`requireSession`), porque el JWT puede estar vigente y
 * el usuario ya bloqueado o su negocio suspendido (03-ARQUITECTURA §4.10).
 *
 * Si Auth no responde, la petición sigue sin refrescar: la landing y el login no deben caer con Auth, y
 * las páginas y comandos privados fallarán por su cuenta al comprobar la sesión.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const env = getPublicEnv();

  const supabase = createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookieOptions: sessionCookieOptions(),
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet, headers) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        // Cabeceras de caché que pide @supabase/ssr al emitir cookies: que un CDN nunca cachee un Set-Cookie.
        for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value);
      },
    },
  });

  try {
    // Sin cookies de sesión no hace ninguna llamada de red; con ellas, renueva si hace falta.
    await supabase.auth.getClaims();
  } catch {
    // Auth caído: se deja pasar (ver arriba). No se registra el motivo: puede incluir datos de la conexión.
  }
  return response;
}

export const config = {
  // Todo menos estáticos, imágenes optimizadas, el icono, la comprobación de salud y login/logout, que
  // gestionan sus propias cookies (si el proxy también las escribiera, el orden de fusión no está garantizado).
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/health|api/auth/login|api/auth/logout).*)",
  ],
};
