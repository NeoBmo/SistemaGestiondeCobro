import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type pg from "pg";
import type { Role } from "@/modules/identity/session";
import { syntheticEmail } from "@/modules/identity/synthetic-email";

/** Pruebas contra el Auth real del Supabase local (la URL y las claves las deja global-setup). */

export const TEST_EMAIL_DOMAIN = "cuadre.invalid";
export const TEMP_PASSWORD = "ClaveTemporal1";

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(`Falta ${name}: lo define global-setup a partir de \`supabase status\`.`);
  return value;
}

export const createAnonClient = (): SupabaseClient =>
  createClient(
    requiredEnv("TEST_SUPABASE_URL"),
    requiredEnv("TEST_SUPABASE_ANON_KEY"),
    clientOptions,
  );

export const createAdminClient = (): SupabaseClient =>
  createClient(
    requiredEnv("TEST_SUPABASE_URL"),
    requiredEnv("TEST_SUPABASE_SERVICE_ROLE_KEY"),
    clientOptions,
  );

export type TestAccount = { userId: string; username: string; password: string };

export function decodeJwtClaims(accessToken: string): Record<string, unknown> {
  const payload = accessToken.split(".")[1] ?? "";
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
}

/**
 * Crea negocios y cuentas reales (Auth + perfil) confirmados en la BD y los elimina al final.
 * `audit_events` es de solo agregado: la limpieza desactiva su trigger dentro de una transacción
 * (solo posible para el dueño de la tabla), borra lo de estas pruebas y lo vuelve a activar.
 */
export class TestFixtures {
  private businessIds: string[] = [];
  private userIds: string[] = [];

  constructor(
    private readonly pool: pg.Pool,
    private readonly admin: SupabaseClient,
  ) {}

  /** Registra lo que creó un comando bajo prueba para que `purge` también lo elimine. */
  track(created: { businessId?: string; userId?: string }): void {
    if (created.businessId) this.businessIds.push(created.businessId);
    if (created.userId) this.userIds.push(created.userId);
  }

  async business(name = "Negocio de prueba"): Promise<string> {
    const unique = `${name} ${randomUUID().slice(0, 8)}`;
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const { rows } = await client.query<{ id: string }>(
        `insert into public.businesses (name, owner_name, owner_identification, phone)
         values ($1, 'Responsable de prueba', '123456', '3000000000') returning id`,
        [unique],
      );
      const id = rows[0]!.id;
      await client.query(
        `insert into public.subscriptions (business_id, plan_code, starts_on, expires_on)
         values ($1, 'MENSUAL', current_date, current_date + 30)`,
        [id],
      );
      await client.query("commit");
      this.businessIds.push(id);
      return id;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async account(options: {
    role: Role;
    businessId: string | null;
    status?: "ACTIVO" | "BLOQUEADO" | "PENDIENTE_CAMBIO_CONTRASENA";
    password?: string;
  }): Promise<TestAccount> {
    const username = `t.${randomUUID().slice(0, 10)}`;
    const password = options.password ?? TEMP_PASSWORD;
    const { data, error } = await this.admin.auth.admin.createUser({
      email: syntheticEmail(username, TEST_EMAIL_DOMAIN),
      password,
      email_confirm: true,
    });
    if (error || !data.user)
      throw new Error(`No se pudo crear el usuario de Auth: ${error?.message}`);
    this.userIds.push(data.user.id);

    await this.pool.query(
      `insert into public.profiles (id, business_id, role, username, display_name, status)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        data.user.id,
        options.businessId,
        options.role,
        username,
        `Usuario ${username}`,
        options.status ?? "ACTIVO",
      ],
    );
    return { userId: data.user.id, username, password };
  }

  /** Suspende negocio y suscripción juntos, como hará el comando real (ADR 0003). */
  async setBusinessAccess(businessId: string, access: "ACTIVO" | "SUSPENDIDO"): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("update public.businesses set access_status = $2 where id = $1", [
        businessId,
        access,
      ]);
      await client.query("update public.subscriptions set status = $2 where business_id = $1", [
        businessId,
        access === "ACTIVO" ? "ACTIVA" : "SUSPENDIDA",
      ]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async setProfileStatus(
    userId: string,
    status: "ACTIVO" | "BLOQUEADO" | "PENDIENTE_CAMBIO_CONTRASENA",
  ) {
    await this.pool.query("update public.profiles set status = $2 where id = $1", [userId, status]);
  }

  async purge(): Promise<void> {
    if (this.userIds.length === 0 && this.businessIds.length === 0) return;
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("alter table public.audit_events disable trigger append_only_row");
      await client.query(
        `delete from public.audit_events
          where actor_id = any($1) or business_id = any($2) or entity_id = any($1) or entity_id = any($2)`,
        [this.userIds, this.businessIds],
      );
      await client.query("alter table public.audit_events enable trigger append_only_row");
      // Las suscripciones primero: `changed_by` apunta a perfiles (p. ej. el Super Admin de la prueba).
      await client.query("delete from public.subscriptions where business_id = any($1)", [
        this.businessIds,
      ]);
      await client.query("delete from public.profiles where id = any($1)", [this.userIds]);
      await client.query("delete from auth.users where id = any($1)", [this.userIds]);
      await client.query("delete from public.businesses where id = any($1)", [this.businessIds]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    this.userIds = [];
    this.businessIds = [];
  }
}
