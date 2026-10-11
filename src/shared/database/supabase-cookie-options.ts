/**
 * Opciones de las cookies de sesión de Supabase, compartidas por el cliente de servidor y el proxy.
 * Todo el acceso a Auth pasa por el servidor (no hay cliente de Supabase en el navegador), así que las
 * cookies son `httpOnly`: un XSS no puede leer el token. `secure` solo en producción (HTTP local).
 */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };
}
