import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { attempt, createRoleClient, createTestPool, withRollback } from "./helpers/db";
import {
  asApiUser,
  createBusiness,
  createProfile,
  createSubscription,
  resetApiUser,
} from "./helpers/identity";

// Endurecimiento tras la revisión independiente de F1-T1: privilegios mínimos, identidad inmutable,
// coherencia negocio ↔ suscripción y hook ejecutado con el rol real de Auth.

const pool = createTestPool();
afterAll(() => pool.end());

const INSUFFICIENT_PRIVILEGE = "42501";
const RESTRICT_VIOLATION = "23001";
const CHECK_VIOLATION = "23514";

async function seedTwoBusinesses(client: pg.PoolClient) {
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
  await createSubscription(client, a);
  await createSubscription(client, b);
  return { a, b, superAdmin, adminA, cobradorA };
}

describe("escritura y auto-elevación por la API de datos", () => {
  const attacks = [
    "update public.profiles set role = 'SUPER_ADMIN'",
    "update public.profiles set business_id = null",
    "update public.profiles set status = 'ACTIVO'",
    "insert into public.profiles (id, role, username, display_name) values (gen_random_uuid(), 'SUPER_ADMIN', 'intruso', 'X')",
    "delete from public.profiles",
    "update public.subscriptions set expires_on = expires_on + 3650",
    "update public.businesses set access_status = 'ACTIVO'",
    "truncate public.businesses",
    "truncate public.audit_events",
  ];

  for (const who of ["cobradorA", "adminA", "superAdmin"] as const) {
    it(`${who} no puede escribir ni elevarse (permission denied)`, async () => {
      await withRollback(pool, async (client) => {
        const s = await seedTwoBusinesses(client);
        const role =
          who === "cobradorA" ? "COBRADOR" : who === "adminA" ? "ADMIN_NEGOCIO" : "SUPER_ADMIN";
        await asApiUser(client, {
          sub: s[who],
          app_role: role,
          business_id: who === "superAdmin" ? null : s.a,
        });

        for (const statement of attacks) {
          expect((await attempt(client, statement))?.code, `${who}: ${statement}`).toBe(
            INSUFFICIENT_PRIVILEGE,
          );
        }
        await resetApiUser(client);
      });
    });
  }

  it("anon tampoco escribe", async () => {
    await withRollback(pool, async (client) => {
      await seedTwoBusinesses(client);
      await asApiUser(client, {}, "anon");

      for (const statement of attacks) {
        expect((await attempt(client, statement))?.code, statement).toBe(INSUFFICIENT_PRIVILEGE);
      }
      await resetApiUser(client);
    });
  });

  it("service_role conserva solo lectura sobre las tablas de identidad", async () => {
    for (const table of ["plans", "businesses", "profiles", "subscriptions", "audit_events"]) {
      const { rows } = await pool.query<{ privilege: string; allowed: boolean }>(
        `select p as privilege, has_table_privilege('service_role', $1, p) as allowed
           from unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) as p`,
        [`public.${table}`],
      );
      expect(
        rows.filter((row) => row.allowed).map((row) => row.privilege),
        table,
      ).toEqual([]);
    }
  });
});

describe("guardianes de privilegios (aplican a toda tabla presente y futura de public)", () => {
  it("toda tabla de public tiene RLS activo", async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      `select c.relname as table_name
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );

    expect(rows.map((row) => row.table_name)).toEqual([]);
  });

  it("anon no tiene privilegios y authenticated no tiene privilegios de escritura en public", async () => {
    const { rows } = await pool.query<{
      grantee: string;
      table_name: string;
      privilege_type: string;
    }>(
      `select grantee, table_name, privilege_type
         from information_schema.role_table_grants
        where table_schema = 'public'
          and (grantee = 'anon'
               or (grantee = 'authenticated' and privilege_type <> 'SELECT'))`,
    );

    expect(rows).toEqual([]);
  });

  it("una tabla nueva de public nace sin privilegios para los roles de la API", async () => {
    await withRollback(pool, async (client) => {
      await client.query("create table public.it_tabla_nueva (id int primary key)");

      for (const role of ["anon", "authenticated", "service_role"]) {
        const { rows } = await client.query<{ privilege: string }>(
          `select p as privilege
             from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) as p
            where has_table_privilege($1, 'public.it_tabla_nueva', p)`,
          [role],
        );
        expect(
          rows.map((row) => row.privilege),
          role,
        ).toEqual([]);
      }
    });
  });

  for (const schema of ["private", "public"]) {
    it(`una función nueva de ${schema} no es ejecutable por PUBLIC ni por los roles de la API`, async () => {
      await withRollback(pool, async (client) => {
        await client.query(
          `create function ${schema}.it_funcion_nueva() returns int language sql as 'select 1'`,
        );

        for (const role of ["anon", "authenticated", "service_role"]) {
          const { rows } = await client.query<{ allowed: boolean }>(
            `select has_function_privilege($1, '${schema}.it_funcion_nueva()', 'EXECUTE') as allowed`,
            [role],
          );
          expect(rows[0]?.allowed, `${schema}: ${role}`).toBe(false);
        }
      });
    });
  }
});

describe("identidad de perfil inmutable (02 §1.4 y §9.2)", () => {
  it("no se pueden cambiar id, rol, negocio ni nombre de usuario", async () => {
    await withRollback(pool, async (client) => {
      const s = await seedTwoBusinesses(client);

      for (const statement of [
        `update public.profiles set role = 'ADMIN_NEGOCIO' where id = '${s.cobradorA}'`,
        `update public.profiles set business_id = '${s.b}' where id = '${s.cobradorA}'`,
        `update public.profiles set username = 'otro.nombre' where id = '${s.cobradorA}'`,
      ]) {
        expect((await attempt(client, statement))?.code, statement).toBe(RESTRICT_VIOLATION);
      }
    });
  });

  it("sí se puede cambiar el estado, el nombre visible y el último acceso", async () => {
    await withRollback(pool, async (client) => {
      const s = await seedTwoBusinesses(client);

      expect(
        await attempt(
          client,
          `update public.profiles set status = 'BLOQUEADO', display_name = 'Nuevo Nombre', last_sign_in_at = now() where id = '${s.cobradorA}'`,
        ),
      ).toBeNull();
    });
  });
});

describe("coherencia negocio ↔ suscripción (ADR 0003)", () => {
  // Fuerza la comprobación diferida y vuelve a diferir, como haría el COMMIT de un comando real.
  const settle = async (client: pg.PoolClient) => {
    const error = await attempt(client, "set constraints all immediate");
    await client.query("set constraints all deferred");
    return error;
  };

  it("un negocio ACTIVO con suscripción ACTIVA es coherente", async () => {
    await withRollback(pool, async (client) => {
      await seedTwoBusinesses(client);

      expect(await settle(client)).toBeNull();
    });
  });

  it("rechaza suspender el negocio sin suspender su suscripción, y al revés", async () => {
    await withRollback(pool, async (client) => {
      const s = await seedTwoBusinesses(client);
      await client.query(
        "update public.businesses set access_status = 'SUSPENDIDO' where id = $1",
        [s.a],
      );
      expect((await settle(client))?.code).toBe(CHECK_VIOLATION);
    });

    await withRollback(pool, async (client) => {
      const s = await seedTwoBusinesses(client);
      await client.query(
        "update public.subscriptions set status = 'ARCHIVADA' where business_id = $1",
        [s.a],
      );
      expect((await settle(client))?.code).toBe(CHECK_VIOLATION);
    });
  });

  it("acepta suspender, activar y archivar cuando ambos campos cambian en la misma transacción", async () => {
    await withRollback(pool, async (client) => {
      const s = await seedTwoBusinesses(client);
      const change = async (access: string, subscription: string) => {
        await client.query("update public.businesses set access_status = $2 where id = $1", [
          s.a,
          access,
        ]);
        await client.query("update public.subscriptions set status = $2 where business_id = $1", [
          s.a,
          subscription,
        ]);
        return settle(client);
      };

      expect(await change("SUSPENDIDO", "SUSPENDIDA")).toBeNull();
      expect(await change("ACTIVO", "ACTIVA")).toBeNull();
      expect(await change("SUSPENDIDO", "ARCHIVADA")).toBeNull();
    });
  });

  it("rechaza crear una suscripción no ACTIVA para un negocio ACTIVO", async () => {
    await withRollback(pool, async (client) => {
      const business = await createBusiness(client, "Negocio C");
      await client.query(
        "insert into public.subscriptions (business_id, plan_code, status, starts_on, expires_on) values ($1, 'MENSUAL', 'SUSPENDIDA', current_date, current_date + 30)",
        [business],
      );

      expect((await settle(client))?.code).toBe(CHECK_VIOLATION);
    });
  });
});

describe("hook de token con el rol real de Auth", () => {
  const event = (userId: string, extraClaims: Record<string, unknown> = {}) =>
    JSON.stringify({
      user_id: userId,
      claims: { sub: userId, role: "authenticated", aud: "authenticated", ...extraClaims },
    });

  it("funciona con la conexión real de supabase_auth_admin (SECURITY DEFINER y grants)", async () => {
    // postgres no puede hacer SET ROLE a supabase_auth_admin: se conecta como él, con fixtures confirmadas.
    const fixtures = await pool.connect();
    const authAdmin = createRoleClient("supabase_auth_admin");
    let businessId: string | undefined;
    let adminId: string | undefined;
    try {
      businessId = await createBusiness(fixtures, "Fixture hook auth");
      await createSubscription(fixtures, businessId);
      adminId = await createProfile(fixtures, {
        role: "ADMIN_NEGOCIO",
        businessId,
        username: `hook.${randomUUID().slice(0, 8)}`,
        status: "ACTIVO",
      });
      await authAdmin.connect();

      const { rows } = await authAdmin.query<{
        who: string;
        result: { claims: Record<string, unknown> };
      }>("select current_user as who, private.custom_access_token_hook($1::jsonb) as result", [
        event(adminId),
      ]);

      expect(rows[0]?.who).toBe("supabase_auth_admin");
      expect(rows[0]?.result.claims).toMatchObject({
        app_role: "ADMIN_NEGOCIO",
        business_id: businessId,
      });
    } finally {
      await authAdmin.end().catch(() => undefined);
      if (adminId) await fixtures.query("delete from public.profiles where id = $1", [adminId]);
      if (adminId) await fixtures.query("delete from auth.users where id = $1", [adminId]);
      if (businessId)
        await fixtures.query("delete from public.subscriptions where business_id = $1", [
          businessId,
        ]);
      if (businessId)
        await fixtures.query("delete from public.businesses where id = $1", [businessId]);
      fixtures.release();
    }
  });

  it("authenticated y anon no pueden invocarlo (permission denied)", async () => {
    await withRollback(pool, async (client) => {
      const s = await seedTwoBusinesses(client);

      for (const role of ["authenticated", "anon"] as const) {
        await client.query(`set local role ${role}`);
        const error = await attempt(client, "select private.custom_access_token_hook($1::jsonb)", [
          event(s.adminA),
        ]);
        await resetApiUser(client);
        expect(error?.code, role).toBe(INSUFFICIENT_PRIVILEGE);
      }
    });
  });

  it("sobrescribe app_role y business_id falsos que ya vengan en los claims", async () => {
    await withRollback(pool, async (client) => {
      const s = await seedTwoBusinesses(client);

      const { rows } = await client.query<{ result: { claims: Record<string, unknown> } }>(
        "select private.custom_access_token_hook($1::jsonb) as result",
        [event(s.cobradorA, { app_role: "SUPER_ADMIN", business_id: s.b })],
      );

      expect(rows[0]?.result.claims).toMatchObject({ app_role: "COBRADOR", business_id: s.a });
    });
  });
});
