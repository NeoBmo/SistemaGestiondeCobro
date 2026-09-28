import type { Pool } from "pg";
import { AppError } from "@/shared/errors/app-error";

export type Role = "SUPER_ADMIN" | "ADMIN_NEGOCIO" | "COBRADOR";

export type SessionContext = {
  userId: string;
  role: Role;
  /** `null` solo para el Super Admin. Sale de la BD, nunca del JWT ni de la petición (regla 1). */
  businessId: string | null;
  username: string;
  displayName: string;
  /** Zona horaria del negocio; `null` para el Super Admin. */
  businessTimeZone: string | null;
  mustChangePassword: boolean;
};

export type RequireSessionOptions = {
  /** Roles permitidos; sin valor, cualquiera. */
  roles?: readonly Role[];
  /** Solo para la pantalla de cambio de contraseña temporal. */
  allowPasswordChangePending?: boolean;
};

type ProfileRow = {
  id: string;
  role: Role;
  business_id: string | null;
  username: string;
  display_name: string;
  status: "ACTIVO" | "BLOQUEADO" | "PENDIENTE_CAMBIO_CONTRASENA";
  access_status: "ACTIVO" | "SUSPENDIDO" | null;
  time_zone: string | null;
};

/**
 * Lee el perfil y el estado del negocio en la BD, la fuente de verdad (el JWT puede tener hasta 1 h
 * de antigüedad, 03-ARQUITECTURA §4.10). Rechaza usuarios sin perfil, bloqueados o de negocios suspendidos.
 */
export async function loadSessionContext(
  userId: string,
  db: Pick<Pool, "query">,
): Promise<SessionContext> {
  const { rows } = await db.query<ProfileRow>(
    `select p.id, p.role, p.business_id, p.username, p.display_name, p.status, b.access_status, b.time_zone
       from public.profiles p
       left join public.businesses b on b.id = p.business_id
      where p.id = $1`,
    [userId],
  );
  const row = rows[0];

  if (!row) {
    throw new AppError("ACCESS_DENIED", "Tu cuenta no tiene acceso a la aplicación", 403);
  }
  if (row.status === "BLOQUEADO") {
    throw new AppError("USER_BLOCKED", "Tu usuario está bloqueado. Contacta al administrador", 403);
  }
  if (row.business_id !== null && row.access_status !== "ACTIVO") {
    throw new AppError(
      "BUSINESS_SUSPENDED",
      "El acceso de tu negocio está suspendido. Contacta al soporte",
      403,
    );
  }

  return {
    userId: row.id,
    role: row.role,
    businessId: row.business_id,
    username: row.username,
    displayName: row.display_name,
    businessTimeZone: row.time_zone,
    mustChangePassword: row.status === "PENDIENTE_CAMBIO_CONTRASENA",
  };
}

/** Aplica rol y cambio de contraseña pendiente sobre un contexto ya cargado. */
export function authorizeSession(
  context: SessionContext,
  options: RequireSessionOptions = {},
): SessionContext {
  if (context.mustChangePassword && !options.allowPasswordChangePending) {
    throw new AppError(
      "PASSWORD_CHANGE_REQUIRED",
      "Debes cambiar tu contraseña temporal antes de continuar",
      403,
    );
  }
  if (options.roles && !options.roles.includes(context.role)) {
    throw new AppError("FORBIDDEN", "No tienes permiso para esta operación", 403);
  }
  return context;
}
