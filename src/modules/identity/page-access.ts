import type { Role, SessionContext } from "./session";

/** Área de inicio de cada rol (03-ARQUITECTURA §2). */
export function homePathFor(role: Role): string {
  switch (role) {
    case "SUPER_ADMIN":
      return "/super-admin";
    case "ADMIN_NEGOCIO":
      return "/negocio";
    case "COBRADOR":
      return "/cobrador";
  }
}

export const PASSWORD_CHANGE_PATH = "/cambiar-contrasena";
export const LOGIN_PATH = "/login";

export type PageAccessOptions = {
  /** Roles que pueden ver la página; sin valor, cualquiera con sesión. */
  roles?: readonly Role[];
  /** Solo la pantalla de cambio de contraseña: la ve únicamente quien la tiene pendiente. */
  requirePasswordChangePending?: boolean;
};

export type PageAccess = { kind: "allow" } | { kind: "redirect"; to: string };

/**
 * Decide qué hacer con un usuario que ya tiene una sesión válida y cargada desde la BD. La seguridad no
 * vive aquí (cada comando vuelve a autorizar en el servidor): esto solo evita mostrar a alguien una
 * pantalla que no es la suya. La contraseña temporal pendiente tiene prioridad sobre el rol.
 */
export function decidePageAccess(context: SessionContext, options: PageAccessOptions): PageAccess {
  if (options.requirePasswordChangePending) {
    return context.mustChangePassword
      ? { kind: "allow" }
      : { kind: "redirect", to: homePathFor(context.role) };
  }
  if (context.mustChangePassword) return { kind: "redirect", to: PASSWORD_CHANGE_PATH };
  if (options.roles && !options.roles.includes(context.role)) {
    return { kind: "redirect", to: homePathFor(context.role) };
  }
  return { kind: "allow" };
}

/** Códigos de `requireSession` que significan «no tienes una sesión utilizable»: se resuelven en /login. */
const LOGIN_REDIRECT_CODES: ReadonlySet<string> = new Set([
  "UNAUTHENTICATED",
  "ACCESS_DENIED",
  "USER_BLOCKED",
  "BUSINESS_SUSPENDED",
]);

/** `null` si el error no es de sesión (un fallo real que no debe disfrazarse de redirección). */
export function redirectForSessionError(code: string): string | null {
  return LOGIN_REDIRECT_CODES.has(code) ? LOGIN_PATH : null;
}
