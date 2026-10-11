import { cache } from "react";
import { redirect } from "next/navigation";
import { isAppError } from "@/shared/errors/app-error";
import { decidePageAccess, redirectForSessionError, type PageAccessOptions } from "./page-access";
import { requireSession } from "./require-session";
import type { SessionContext } from "./session";

/** Una sola lectura de la sesión por petición, aunque la pidan el layout y la página. */
const loadSession = cache(() => requireSession({ allowPasswordChangePending: true }));

/**
 * Sesión para un Server Component (página o layout): devuelve el contexto leído de la BD o redirige.
 * Sin sesión utilizable → /login; contraseña temporal pendiente → /cambiar-contrasena; área de otro
 * rol → la propia. Cualquier otro error es un fallo real y se propaga (no se disfraza de redirección).
 *
 * Esto es comodidad de navegación, no el control de acceso: cada Route Handler y cada comando vuelve a
 * autorizar en el servidor. Los layouts no se vuelven a renderizar al navegar entre páginas, así que
 * cada página protegida también debe llamarlo.
 */
export async function getPageSession(options: PageAccessOptions = {}): Promise<SessionContext> {
  let context: SessionContext;
  try {
    context = await loadSession();
  } catch (error) {
    const target = isAppError(error) ? redirectForSessionError(error.code) : null;
    if (target) redirect(target);
    throw error;
  }

  const access = decidePageAccess(context, options);
  if (access.kind === "redirect") redirect(access.to);
  return context;
}

export type OptionalPageSession =
  | { context: SessionContext; denied?: undefined }
  | { context?: undefined; denied: { code: string; message: string } };

/**
 * Sesión para páginas públicas (login). Devuelve el contexto, o `denied` con el motivo cuando no hay una
 * sesión utilizable (`UNAUTHENTICATED` = nadie ha iniciado sesión; el resto = bloqueado, negocio
 * suspendido, sin perfil). Cualquier otro error es un fallo real y se propaga.
 */
export async function getOptionalPageSession(): Promise<OptionalPageSession> {
  try {
    return { context: await loadSession() };
  } catch (error) {
    if (isAppError(error) && redirectForSessionError(error.code)) {
      return { denied: { code: error.code, message: error.message } };
    }
    throw error;
  }
}
