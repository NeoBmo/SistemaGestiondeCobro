import { afterAll, describe, expect, it } from "vitest";
import { createSuperAdmin } from "../../../scripts/create-super-admin.mjs";
import { signInWithUsername } from "@/modules/identity/login";
import {
  TEST_EMAIL_DOMAIN,
  TestFixtures,
  createAdminClient,
  createAnonClient,
} from "./helpers/auth";
import { createTestPool } from "./helpers/db";

// Arranque de la plataforma: el primer Super Admin se crea con un script, no con un endpoint.

const pool = createTestPool();
const admin = createAdminClient();
const fixtures = new TestFixtures(pool, admin);

afterAll(async () => {
  await fixtures.purge();
  await pool.end();
});

const deps = { db: pool, admin, syntheticEmailDomain: TEST_EMAIL_DOMAIN };
const unique = () => `root.${crypto.randomUUID().slice(0, 8)}`;
const who = { reason: "Alta de prueba del soporte de guardia", operator: "luis" };
const authUserExists = async (username: string) =>
  ((
    await pool.query("select 1 from auth.users where email = $1", [
      `${username}@${TEST_EMAIL_DOMAIN}`,
    ])
  ).rowCount ?? 0) === 1;

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return (error as { code?: string }).code ?? "SIN_CODIGO";
  }
  return undefined;
}

describe("createSuperAdmin (scripts/create-super-admin.mjs)", () => {
  it("crea un Super Admin ACTIVO sin negocio, auditado con motivo y usuario del SO, que puede iniciar sesión", async () => {
    const username = unique();

    const result = await createSuperAdmin(deps, {
      username: `  ${username.toUpperCase()} `,
      displayName: "  Plataforma Cuadre ",
      password: "ClaveSegura2026",
      reason: "  Alta de prueba del soporte de guardia ",
      operator: "luis",
    });
    fixtures.track({ userId: result.userId });

    expect(result.username).toBe(username);
    const profile = await pool.query(
      "select business_id, role, display_name, status from public.profiles where id = $1",
      [result.userId],
    );
    expect(profile.rows[0]).toEqual({
      business_id: null,
      role: "SUPER_ADMIN",
      display_name: "Plataforma Cuadre",
      status: "ACTIVO",
    });

    const audit = await pool.query(
      `select action, actor_id, business_id, result, summary, occurred_at is not null as dated
         from public.audit_events where entity_id = $1`,
      [result.userId],
    );
    expect(audit.rows).toEqual([
      {
        action: "SuperAdminCreado",
        actor_id: null,
        business_id: null,
        result: "OK",
        summary: {
          role: "SUPER_ADMIN",
          username,
          origin: "script",
          reason: "Alta de prueba del soporte de guardia",
          operator: "luis",
        },
        dated: true,
      },
    ]);
    expect(JSON.stringify(audit.rows)).not.toContain("ClaveSegura2026");

    const login = await signInWithUsername(
      { supabase: createAnonClient(), db: pool, syntheticEmailDomain: TEST_EMAIL_DOMAIN },
      { username, password: "ClaveSegura2026" },
    );
    expect(login).toEqual({
      userId: result.userId,
      role: "SUPER_ADMIN",
      mustChangePassword: false,
    });
  });

  it("rechaza usuario, nombre o contraseña inválidos sin crear nada", async () => {
    const username = unique();
    const good = { username, displayName: "Root", password: "ClaveSegura2026", ...who };
    const cases: [Partial<typeof good>, string][] = [
      [{ reason: "   " }, "INVALID_REASON"],
      [{ reason: "x".repeat(501) }, "INVALID_REASON"],
      [{ operator: "" }, "INVALID_OPERATOR"],
      [{ username: "No Válido" }, "INVALID_USERNAME"],
      [{ displayName: "   " }, "INVALID_DISPLAY_NAME"],
      [{ password: "corta1" }, "INVALID_PASSWORD"],
      [{ password: "soloLetrasAqui" }, "INVALID_PASSWORD"],
    ];

    for (const [override, code] of cases) {
      expect(await codeOf(createSuperAdmin(deps, { ...good, ...override })), code).toBe(code);
    }
    expect(await authUserExists(username)).toBe(false);
  });

  it("rechaza un usuario ya existente (perfil o residuo en Auth)", async () => {
    const username = unique();
    const first = await createSuperAdmin(deps, {
      username,
      displayName: "Root",
      password: "ClaveSegura2026",
      ...who,
    });
    fixtures.track({ userId: first.userId });

    expect(
      await codeOf(
        createSuperAdmin(deps, {
          username,
          displayName: "Otro",
          password: "ClaveSegura2026",
          ...who,
        }),
      ),
    ).toBe("USERNAME_TAKEN");
  });

  it("si la auditoría falla, la transacción se revierte: ni perfil ni usuario de Auth", async () => {
    const username = unique();
    // Rompe solo la inserción del evento: el perfil ya insertado debe revertirse y Auth compensarse.
    const failingAuditDb = {
      query: pool.query.bind(pool),
      connect: async () => {
        const client = await pool.connect();
        const query = client.query.bind(client) as (...args: unknown[]) => Promise<unknown>;
        // Envoltorio, no mutación: la conexión vuelve intacta al pool compartido.
        return {
          query: (text: unknown, ...rest: unknown[]) =>
            typeof text === "string" && text.includes("audit_events")
              ? Promise.reject(new Error("auditoría caída"))
              : query(text, ...rest),
          release: client.release.bind(client),
        };
      },
    } as unknown as typeof deps.db;

    await expect(
      createSuperAdmin(
        { ...deps, db: failingAuditDb },
        { username, displayName: "Root", password: "ClaveSegura2026", ...who },
      ),
    ).rejects.toThrow("auditoría caída");
    expect(await authUserExists(username)).toBe(false);
    const profile = await pool.query("select 1 from public.profiles where username = $1", [
      username,
    ]);
    expect(profile.rowCount).toBe(0);
  });

  it("si la BD falla, elimina el usuario de Auth y no queda nada", async () => {
    const username = unique();
    const brokenDb = {
      query: pool.query.bind(pool),
      connect: async () => {
        throw new Error("BD caída");
      },
    } as unknown as typeof deps.db;

    await expect(
      createSuperAdmin(
        { ...deps, db: brokenDb },
        { username, displayName: "Root", password: "ClaveSegura2026", ...who },
      ),
    ).rejects.toThrow("BD caída");
    expect(await authUserExists(username)).toBe(false);
  });
});
