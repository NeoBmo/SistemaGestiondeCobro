import { afterEach, describe, expect, it, vi } from "vitest";

// Autenticación y mapeo HTTP del chequeo programado; el flujo real se cubre en integración (monitoring.test.ts).

const runHealthCheck = vi.fn();
const getServerEnv = vi.fn();

vi.mock("@/modules/monitoring/health", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/monitoring/health")>()),
  runHealthCheck,
  authHealth: vi.fn(),
}));
vi.mock("@/shared/database/pg-pool", () => ({ getPool: () => "pool" }));
vi.mock("@/shared/validation/env", () => ({
  getServerEnv,
  getPublicEnv: () => ({ supabaseUrl: "http://localhost:54321" }),
}));

const SECRET = "s".repeat(40);
const post = async (authorization?: string) => {
  const { POST } = await import("./route");
  return POST(
    new Request("https://app.cuadre.test/api/monitoreo/chequeo", {
      method: "POST",
      headers: authorization ? { authorization } : {},
    }),
  );
};

afterEach(() => vi.resetAllMocks());

describe("POST /api/monitoreo/chequeo", () => {
  it("sin secreto configurado o con uno incorrecto responde 404 sin ejecutar nada", async () => {
    getServerEnv.mockReturnValue({});
    expect((await post(`Bearer ${SECRET}`)).status).toBe(404);
    getServerEnv.mockReturnValue({ monitorSecret: SECRET });
    expect((await post()).status).toBe(404);
    expect((await post("Bearer otro")).status).toBe(404);
    expect(runHealthCheck).not.toHaveBeenCalled();
  });

  it("con el secreto responde 200 si todo está bien y 503 si un componente falla", async () => {
    getServerEnv.mockReturnValue({ monitorSecret: SECRET });
    runHealthCheck.mockResolvedValueOnce({
      ok: true,
      databaseOk: true,
      authOk: true,
      latencyMs: 12,
    });
    const ok = await post(`Bearer ${SECRET}`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");

    runHealthCheck.mockResolvedValueOnce({
      ok: false,
      databaseOk: true,
      authOk: false,
      latencyMs: 900,
    });
    expect((await post(`Bearer ${SECRET}`)).status).toBe(503);
  });
});
