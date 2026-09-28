import type pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { createTestPool, withRollback } from "./helpers/db";
import { createBusiness, createProfile } from "./helpers/identity";

// 03-ARQUITECTURA §4.7 y ADR 0003: el JWT lleva business_id y app_role; los usuarios bloqueados o de
// un negocio suspendido no obtienen (ni refrescan) token.

const pool = createTestPool();
afterAll(() => pool.end());

async function runHook(client: pg.PoolClient, userId: string): Promise<Record<string, unknown>> {
  const event = {
    user_id: userId,
    claims: { sub: userId, role: "authenticated", aud: "authenticated" },
  };
  const { rows } = await client.query<{ result: Record<string, unknown> }>(
    "select private.custom_access_token_hook($1::jsonb) as result",
    [JSON.stringify(event)],
  );
  return rows[0]!.result;
}

const claimsOf = (result: Record<string, unknown>) => result.claims as Record<string, unknown>;
const forbidden = { error: { http_code: 403, message: "Acceso no permitido" } };

describe("private.custom_access_token_hook", () => {
  it("añade app_role y business_id conservando los claims existentes", async () => {
    await withRollback(pool, async (client) => {
      const business = await createBusiness(client, "Negocio A");
      const admin = await createProfile(client, {
        role: "ADMIN_NEGOCIO",
        businessId: business,
        username: "admin.a",
        status: "ACTIVO",
      });

      expect(claimsOf(await runHook(client, admin))).toEqual({
        sub: admin,
        role: "authenticated",
        aud: "authenticated",
        app_role: "ADMIN_NEGOCIO",
        business_id: business,
      });
    });
  });

  it("el Super Admin lleva business_id nulo", async () => {
    await withRollback(pool, async (client) => {
      const root = await createProfile(client, {
        role: "SUPER_ADMIN",
        businessId: null,
        username: "root.admin",
        status: "ACTIVO",
      });

      const claims = claimsOf(await runHook(client, root));
      expect(claims.app_role).toBe("SUPER_ADMIN");
      expect(claims.business_id).toBeNull();
    });
  });

  it("un usuario con contraseña temporal sí obtiene token (debe poder cambiarla)", async () => {
    await withRollback(pool, async (client) => {
      const business = await createBusiness(client, "Negocio A");
      const cobrador = await createProfile(client, {
        role: "COBRADOR",
        businessId: business,
        username: "cobrador.a",
      });

      expect(claimsOf(await runHook(client, cobrador)).app_role).toBe("COBRADOR");
    });
  });

  it("rechaza con 403 a un usuario BLOQUEADO", async () => {
    await withRollback(pool, async (client) => {
      const business = await createBusiness(client, "Negocio A");
      const blocked = await createProfile(client, {
        role: "COBRADOR",
        businessId: business,
        username: "bloqueado",
        status: "BLOQUEADO",
      });

      expect(await runHook(client, blocked)).toEqual(forbidden);
    });
  });

  it("rechaza con 403 a los usuarios de un negocio SUSPENDIDO, y solo a ellos", async () => {
    await withRollback(pool, async (client) => {
      const suspended = await createBusiness(client, "Suspendido");
      const active = await createBusiness(client, "Activo");
      const adminSuspended = await createProfile(client, {
        role: "ADMIN_NEGOCIO",
        businessId: suspended,
        username: "admin.s",
        status: "ACTIVO",
      });
      const adminActive = await createProfile(client, {
        role: "ADMIN_NEGOCIO",
        businessId: active,
        username: "admin.v",
        status: "ACTIVO",
      });
      await client.query(
        "update public.businesses set access_status = 'SUSPENDIDO' where id = $1",
        [suspended],
      );

      expect(await runHook(client, adminSuspended)).toEqual(forbidden);
      expect(claimsOf(await runHook(client, adminActive)).app_role).toBe("ADMIN_NEGOCIO");
    });
  });

  it("al reactivar el negocio vuelve a emitir token", async () => {
    await withRollback(pool, async (client) => {
      const business = await createBusiness(client, "Negocio A");
      const admin = await createProfile(client, {
        role: "ADMIN_NEGOCIO",
        businessId: business,
        username: "admin.a",
        status: "ACTIVO",
      });

      await client.query(
        "update public.businesses set access_status = 'SUSPENDIDO' where id = $1",
        [business],
      );
      expect(await runHook(client, admin)).toEqual(forbidden);

      await client.query("update public.businesses set access_status = 'ACTIVO' where id = $1", [
        business,
      ]);
      expect(claimsOf(await runHook(client, admin)).business_id).toBe(business);
    });
  });

  it("rechaza con 403 a un usuario de Auth sin perfil", async () => {
    await withRollback(pool, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        "insert into auth.users (id, email) values (gen_random_uuid(), 'sin-perfil@test.invalid') returning id::text",
      );

      expect(await runHook(client, rows[0]!.id)).toEqual(forbidden);
    });
  });

  it("solo supabase_auth_admin puede ejecutarlo", async () => {
    const privilege = async (role: string) => {
      const { rows } = await pool.query<{ allowed: boolean }>(
        "select has_function_privilege($1, 'private.custom_access_token_hook(jsonb)', 'EXECUTE') as allowed",
        [role],
      );
      return rows[0]?.allowed;
    };

    expect(await privilege("supabase_auth_admin")).toBe(true);
    for (const role of ["anon", "authenticated"]) {
      expect(await privilege(role), role).toBe(false);
    }
  });
});
