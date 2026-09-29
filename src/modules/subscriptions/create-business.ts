import type { SupabaseClient } from "@supabase/supabase-js";
import type { Pool } from "pg";
import { recordAuditEvent } from "@/modules/audit/record-audit-event";
import { authorizeSession, type SessionContext } from "@/modules/identity/session";
import { syntheticEmail } from "@/modules/identity/synthetic-email";
import { generateTemporaryPassword } from "@/modules/identity/temporary-password";
import { parseUsername } from "@/modules/identity/username";
import { withTransaction } from "@/shared/database/with-transaction";
import { localDateIn } from "@/shared/dates/dates";
import { AppError } from "@/shared/errors/app-error";
import { isPlanCode, subscriptionExpiry, type PlanCode } from "./plans";

/** V1 opera en COP (03 §7); el Super Admin puede fijar otra zona al crear el negocio. */
export const DEFAULT_TIME_ZONE = "America/Bogota";

export type CreateBusinessInput = {
  name: string;
  ownerName: string;
  ownerIdentification: string;
  phone: string;
  planCode: PlanCode;
  timeZone?: string;
  adminUsername: string;
  /** Por defecto, el nombre del responsable. */
  adminDisplayName?: string;
};

export type CreateBusinessDeps = {
  db: Pick<Pool, "connect" | "query">;
  admin: { auth: { admin: Pick<SupabaseClient["auth"]["admin"], "createUser" | "deleteUser"> } };
  syntheticEmailDomain: string;
  now?: () => Date;
  generatePassword?: () => string;
};

export type CreateBusinessResult = {
  businessId: string;
  subscriptionId: string;
  admin: { userId: string; username: string };
  /** Se muestra una sola vez a quien crea la cuenta: no se almacena ni se audita. */
  temporaryPassword: string;
};

const usernameTaken = () =>
  new AppError("USERNAME_TAKEN", "Ese nombre de usuario ya está en uso. Elige otro", 409);

/**
 * Crea un negocio con su suscripción vigente y su cuenta administrativa inicial (02-DOMINIO §1.2–1.4;
 * solo el Super Admin). Auth y la BD no son atómicos entre sí (03 §3): se crea el usuario en Auth, se
 * ejecuta una única transacción (negocio, suscripción, perfil y auditoría) y, si esa falla, se elimina
 * el usuario de Auth. No lleva clave de idempotencia (no es un comando financiero): un doble envío
 * lo frena la unicidad del nombre de usuario.
 */
export async function createBusiness(
  deps: CreateBusinessDeps,
  actor: SessionContext,
  input: CreateBusinessInput,
): Promise<CreateBusinessResult> {
  authorizeSession(actor, { roles: ["SUPER_ADMIN"] });

  const username = parseUsername(input.adminUsername);
  if (!isPlanCode(input.planCode)) throw new AppError("INVALID_PLAN", "El plan no es válido");
  const timeZone = input.timeZone ?? DEFAULT_TIME_ZONE;
  // Misma fuente que el CHECK de la BD (`pg_timezone_names`: distingue mayúsculas, sin offsets).
  // `Intl` (usado por localDateIn) es más permisivo y fallaría tarde, después de crear el usuario en Auth.
  if (!(await isKnownTimeZone(deps.db, timeZone))) {
    throw new AppError("INVALID_TIME_ZONE", `Zona horaria inválida: ${timeZone}`);
  }
  const startsOn = localDateIn((deps.now ?? (() => new Date()))(), timeZone);
  const expiresOn = subscriptionExpiry(input.planCode, startsOn);

  if (await usernameInUse(deps.db, username)) throw usernameTaken();

  const temporaryPassword = (deps.generatePassword ?? generateTemporaryPassword)();
  const email = syntheticEmail(username, deps.syntheticEmailDomain);
  const created = await deps.admin.auth.admin.createUser({
    email,
    password: temporaryPassword,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    // Bajo concurrencia Auth no responde `email_exists` sino un 500 genérico: se confirma en la tabla.
    if (created.error?.code === "email_exists" || (await authEmailExists(deps.db, email))) {
      throw usernameTaken();
    }
    throw new AppError("AUTH_UNAVAILABLE", "No se pudo crear la cuenta. Intenta de nuevo", 503);
  }
  const userId = created.data.user.id;

  try {
    return await withTransaction(async (tx) => {
      const business = await tx.query<{ id: string }>(
        `insert into public.businesses (name, owner_name, owner_identification, phone, time_zone)
         values ($1, $2, $3, $4, $5) returning id`,
        [input.name, input.ownerName, input.ownerIdentification, input.phone, timeZone],
      );
      const businessId = business.rows[0]!.id;

      const subscription = await tx.query<{ id: string }>(
        `insert into public.subscriptions (business_id, plan_code, starts_on, expires_on, changed_by)
         values ($1, $2, $3, $4, $5) returning id`,
        [businessId, input.planCode, startsOn, expiresOn, actor.userId],
      );
      const subscriptionId = subscription.rows[0]!.id;

      await tx.query(
        `insert into public.profiles (id, business_id, role, username, display_name)
         values ($1, $2, 'ADMIN_NEGOCIO', $3, $4)`,
        [userId, businessId, username, input.adminDisplayName ?? input.ownerName],
      );

      const audit = { businessId, actorId: actor.userId };
      await recordAuditEvent(tx, {
        ...audit,
        action: "NegocioCreado",
        entityType: "business",
        entityId: businessId,
        summary: { name: input.name, planCode: input.planCode, timeZone },
      });
      await recordAuditEvent(tx, {
        ...audit,
        action: "SuscripcionCreada",
        entityType: "subscription",
        entityId: subscriptionId,
        summary: { planCode: input.planCode, startsOn, expiresOn },
      });
      await recordAuditEvent(tx, {
        ...audit,
        action: "UsuarioCreado",
        entityType: "profile",
        entityId: userId,
        summary: { role: "ADMIN_NEGOCIO", username },
      });

      return {
        businessId,
        subscriptionId,
        admin: { userId, username },
        temporaryPassword,
      };
    }, deps.db);
  } catch (failure) {
    await removeOrphanAuthUser(deps, userId);
    if (isUniqueViolation(failure, "profiles_username_key")) throw usernameTaken();
    throw failure;
  }
}

async function usernameInUse(db: Pick<Pool, "query">, username: string): Promise<boolean> {
  const { rowCount } = await db.query("select 1 from public.profiles where username = $1", [
    username,
  ]);
  return (rowCount ?? 0) > 0;
}

async function isKnownTimeZone(db: Pick<Pool, "query">, timeZone: string): Promise<boolean> {
  const { rowCount } = await db.query(
    "select 1 from pg_catalog.pg_timezone_names where name = $1",
    [timeZone],
  );
  return (rowCount ?? 0) > 0;
}

async function authEmailExists(db: Pick<Pool, "query">, email: string): Promise<boolean> {
  const { rowCount } = await db.query("select 1 from auth.users where email = $1", [email]);
  return (rowCount ?? 0) > 0;
}

/** Compensación: sin perfil, el usuario de Auth no sirve y además ocuparía el nombre de usuario. */
async function removeOrphanAuthUser(deps: CreateBusinessDeps, userId: string): Promise<void> {
  try {
    const { error } = await deps.admin.auth.admin.deleteUser(userId);
    if (error) throw new Error(error.message);
  } catch {
    // Solo el id: hay que limpiarlo a mano y no se debe registrar nada más.
    console.error("[create-business] no se pudo eliminar el usuario de Auth huérfano:", userId);
  }
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  const candidate = error as { code?: string; constraint?: string } | null;
  return candidate?.code === "23505" && candidate.constraint === constraint;
}
