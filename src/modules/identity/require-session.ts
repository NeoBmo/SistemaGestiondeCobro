import { getPool } from "@/shared/database/pg-pool";
import { createSupabaseServerClient } from "@/shared/database/supabase-server";
import { AppError } from "@/shared/errors/app-error";
import {
  authorizeSession,
  loadSessionContext,
  type RequireSessionOptions,
  type SessionContext,
} from "./session";

/**
 * Sesión del usuario que hace la petición, validada contra Supabase Auth y contra la BD en cada
 * llamada. Es la única fuente de `businessId` y `role` para un Route Handler o Server Component.
 */
export async function requireSession(options: RequireSessionOptions = {}): Promise<SessionContext> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new AppError("UNAUTHENTICATED", "Inicia sesión para continuar", 401);
  }
  return authorizeSession(await loadSessionContext(data.user.id, getPool()), options);
}
