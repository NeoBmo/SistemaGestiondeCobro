import { randomUUID } from "node:crypto";
import type pg from "pg";

type Role = "SUPER_ADMIN" | "ADMIN_NEGOCIO" | "COBRADOR";

/** Crea un usuario de Supabase Auth mínimo (solo para pruebas; no se puede iniciar sesión con él). */
export async function createAuthUser(client: pg.PoolClient, label: string): Promise<string> {
  const id = randomUUID();
  await client.query("insert into auth.users (id, email) values ($1, $2)", [
    id,
    `${label}-${id}@test.invalid`,
  ]);
  return id;
}

export async function createBusiness(client: pg.PoolClient, name: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into public.businesses (name, owner_name, owner_identification, phone)
     values ($1, 'Responsable de prueba', '123456', '3000000000') returning id`,
    [name],
  );
  return rows[0]!.id;
}

export async function createProfile(
  client: pg.PoolClient,
  options: {
    role: Role;
    businessId: string | null;
    username: string;
    status?: "ACTIVO" | "BLOQUEADO" | "PENDIENTE_CAMBIO_CONTRASENA";
  },
): Promise<string> {
  const id = await createAuthUser(client, options.username);
  await client.query(
    `insert into public.profiles (id, business_id, role, username, display_name, status)
     values ($1, $2, $3, $4, $5, coalesce($6, 'PENDIENTE_CAMBIO_CONTRASENA'))`,
    [
      id,
      options.businessId,
      options.role,
      options.username,
      `Usuario ${options.username}`,
      options.status,
    ],
  );
  return id;
}

export async function createSubscription(
  client: pg.PoolClient,
  businessId: string,
  planCode = "MENSUAL",
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into public.subscriptions (business_id, plan_code, starts_on, expires_on)
     values ($1, $2, current_date, current_date + 30) returning id`,
    [businessId, planCode],
  );
  return rows[0]!.id;
}

export async function createAuditEvent(
  client: pg.PoolClient,
  businessId: string | null,
  action: string,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into public.audit_events (business_id, action, entity_type, entity_id)
     values ($1, $2, 'test', gen_random_uuid()) returning id`,
    [businessId, action],
  );
  return rows[0]!.id;
}

/**
 * Consulta como lo haría la API de datos de Supabase: rol de Postgres + claims del JWT.
 * Debe llamarse dentro de una transacción; `resetApiUser` vuelve al rol dueño.
 */
export async function asApiUser(
  client: pg.PoolClient,
  claims: { sub?: string; app_role?: Role; business_id?: string | null },
  role: "authenticated" | "anon" = "authenticated",
): Promise<void> {
  await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
  await client.query(`set local role ${role}`);
}

export async function resetApiUser(client: pg.PoolClient): Promise<void> {
  await client.query("reset role");
}
