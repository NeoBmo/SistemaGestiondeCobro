import { afterEach, describe, expect, it, vi } from "vitest";

const env = {
  NEXT_PUBLIC_SUPABASE_URL: "https://proyecto.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  DATABASE_URL: "postgresql://usuario:clave@db.ejemplo.local:6543/postgres",
  AUTH_SYNTHETIC_EMAIL_DOMAIN: "cuadre.invalid",
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("createSupabaseAdminClient", () => {
  it("falla con INVALID_ENV si falta la configuración", async () => {
    for (const key of Object.keys(env)) vi.stubEnv(key, "");
    const { createSupabaseAdminClient } = await import("./supabase-admin");

    expect(() => createSupabaseAdminClient()).toThrowError(
      expect.objectContaining({ code: "INVALID_ENV" }),
    );
  });

  it("crea el cliente con la configuración válida", async () => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    const { createSupabaseAdminClient } = await import("./supabase-admin");

    const client = createSupabaseAdminClient();

    expect(client.auth).toBeDefined();
  });
});
