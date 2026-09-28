import type pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { attempt, createTestPool, withRollback } from "./helpers/db";
import {
  asApiUser,
  createAuditEvent,
  createBusiness,
  createProfile,
  createSubscription,
  resetApiUser,
} from "./helpers/identity";

// 03-ARQUITECTURA §4 y regla 1: aislamiento estricto por business_id. Se consulta como la API de
// datos de Supabase: rol de Postgres `authenticated` + claims `app_role` / `business_id` del JWT.

const pool = createTestPool();
afterAll(() => pool.end());

const INSUFFICIENT_PRIVILEGE = "42501";

type Seed = Awaited<ReturnType<typeof seed>>;

async function seed(client: pg.PoolClient) {
  const a = await createBusiness(client, "Negocio A");
  const b = await createBusiness(client, "Negocio B");
  const superAdmin = await createProfile(client, {
    role: "SUPER_ADMIN",
    businessId: null,
    username: "root.admin",
  });
  const adminA = await createProfile(client, {
    role: "ADMIN_NEGOCIO",
    businessId: a,
    username: "admin.a",
  });
  const cobradorA = await createProfile(client, {
    role: "COBRADOR",
    businessId: a,
    username: "cobrador.a",
  });
  const adminB = await createProfile(client, {
    role: "ADMIN_NEGOCIO",
    businessId: b,
    username: "admin.b",
  });
  await createSubscription(client, a);
  await createSubscription(client, b);
  await createAuditEvent(client, a, "EventoA");
  await createAuditEvent(client, b, "EventoB");
  await createAuditEvent(client, null, "EventoPlataforma");
  return { a, b, superAdmin, adminA, cobradorA, adminB };
}

async function names(client: pg.PoolClient, sql: string): Promise<string[]> {
  const { rows } = await client.query<{ label: string }>(sql);
  return rows.map((row) => row.label);
}

const claimsOf = (s: Seed, who: "adminA" | "cobradorA" | "adminB" | "superAdmin") => {
  const businessId = who === "adminA" || who === "cobradorA" ? s.a : who === "adminB" ? s.b : null;
  const role =
    who === "superAdmin" ? "SUPER_ADMIN" : who === "cobradorA" ? "COBRADOR" : "ADMIN_NEGOCIO";
  return { sub: s[who], app_role: role, business_id: businessId } as const;
};

describe("RLS de identidad", () => {
  it("el admin de A solo ve su negocio, su suscripción, sus usuarios y su auditoría", async () => {
    await withRollback(pool, async (client) => {
      const s = await seed(client);
      await asApiUser(client, claimsOf(s, "adminA"));

      expect(await names(client, "select name as label from public.businesses")).toEqual([
        "Negocio A",
      ]);
      expect(
        await names(
          client,
          "select business_id::text = '" + s.a + "' as label from public.subscriptions",
        ),
      ).toEqual([true]);
      expect(
        await names(client, "select username as label from public.profiles order by username"),
      ).toEqual(["admin.a", "cobrador.a"]);
      expect(await names(client, "select action as label from public.audit_events")).toEqual([
        "EventoA",
      ]);
      expect(await names(client, "select code as label from public.plans")).toHaveLength(3);
    });
  });

  it("el cobrador de A solo ve su propio perfil; no ve negocio (datos del responsable), suscripción ni auditoría", async () => {
    await withRollback(pool, async (client) => {
      const s = await seed(client);
      await asApiUser(client, claimsOf(s, "cobradorA"));

      expect(await names(client, "select name as label from public.businesses")).toEqual([]);
      expect(await names(client, "select username as label from public.profiles")).toEqual([
        "cobrador.a",
      ]);
      expect(await names(client, "select id::text as label from public.subscriptions")).toEqual([]);
      expect(await names(client, "select action as label from public.audit_events")).toEqual([]);
    });
  });

  it("el admin de B no ve nada de A", async () => {
    await withRollback(pool, async (client) => {
      const s = await seed(client);
      await asApiUser(client, claimsOf(s, "adminB"));

      expect(await names(client, "select name as label from public.businesses")).toEqual([
        "Negocio B",
      ]);
      expect(await names(client, "select username as label from public.profiles")).toEqual([
        "admin.b",
      ]);
      expect(await names(client, "select action as label from public.audit_events")).toEqual([
        "EventoB",
      ]);
    });
  });

  it("el Super Admin ve todos los negocios, usuarios, suscripciones y auditoría", async () => {
    await withRollback(pool, async (client) => {
      const s = await seed(client);
      await asApiUser(client, claimsOf(s, "superAdmin"));

      // Se filtra por lo sembrado: la base local puede contener datos de otras pruebas.
      const ids = `('${s.a}', '${s.b}')`;
      expect(
        await names(
          client,
          `select name as label from public.businesses where id in ${ids} order by name`,
        ),
      ).toEqual(["Negocio A", "Negocio B"]);
      expect(
        await names(
          client,
          `select username as label from public.profiles where business_id in ${ids} or role = 'SUPER_ADMIN' and id = '${s.superAdmin}'`,
        ),
      ).toHaveLength(4);
      expect(
        await names(
          client,
          `select id::text as label from public.subscriptions where business_id in ${ids}`,
        ),
      ).toHaveLength(2);
      expect(
        await names(
          client,
          "select action as label from public.audit_events where action like 'Evento%'",
        ),
      ).toHaveLength(3);
    });
  });

  it("un JWT sin claims propios no ve negocios ni perfiles ajenos (solo el propio perfil)", async () => {
    await withRollback(pool, async (client) => {
      const s = await seed(client);
      await asApiUser(client, { sub: s.adminA });

      expect(await names(client, "select name as label from public.businesses")).toEqual([]);
      expect(await names(client, "select username as label from public.profiles")).toEqual([
        "admin.a",
      ]);
      expect(await names(client, "select action as label from public.audit_events")).toEqual([]);
    });
  });

  it("un JWT con business_id de otro negocio pero rol COBRADOR no gana acceso administrativo", async () => {
    await withRollback(pool, async (client) => {
      const s = await seed(client);
      await asApiUser(client, { sub: s.cobradorA, app_role: "COBRADOR", business_id: s.b });

      expect(await names(client, "select username as label from public.profiles")).toEqual([
        "cobrador.a",
      ]);
      expect(await names(client, "select id::text as label from public.subscriptions")).toEqual([]);
    });
  });

  it("anon no puede leer ninguna tabla de identidad", async () => {
    await withRollback(pool, async (client) => {
      await seed(client);
      await asApiUser(client, {}, "anon");

      for (const table of ["plans", "businesses", "profiles", "subscriptions", "audit_events"]) {
        expect((await attempt(client, `select * from public.${table}`))?.code, table).toBe(
          INSUFFICIENT_PRIVILEGE,
        );
      }
    });
  });

  it("ningún rol de la API escribe: INSERT/UPDATE/DELETE reciben permission denied", async () => {
    await withRollback(pool, async (client) => {
      const s = await seed(client);
      await asApiUser(client, claimsOf(s, "superAdmin"));

      const writes = [
        "insert into public.businesses (name, owner_name, owner_identification, phone) values ('X', 'R', '1', '3')",
        "update public.businesses set name = 'Hackeado'",
        "delete from public.businesses",
        "update public.profiles set role = 'SUPER_ADMIN'",
        "update public.subscriptions set status = 'ARCHIVADA'",
        "update public.plans set price_amount = 0",
        "insert into public.audit_events (action, entity_type, entity_id) values ('x', 'test', gen_random_uuid())",
      ];
      for (const statement of writes) {
        expect((await attempt(client, statement))?.code, statement).toBe(INSUFFICIENT_PRIVILEGE);
      }
      await resetApiUser(client);
    });
  });
});
