import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/shared/errors/app-error";

// Orden y mapeo HTTP de las rutas de cobradores; el flujo real se cubre en integración (collectors.test.ts).

const requireSession = vi.fn();
const authorizeBusinessAdmin = vi.fn();
const createCollector = vi.fn();
const deactivateCollector = vi.fn();
const reactivateCollector = vi.fn();
const resetCollectorPassword = vi.fn();

vi.mock("@/modules/identity/require-session", () => ({ requireSession }));
vi.mock("@/modules/identity/authorize-business-admin", () => ({ authorizeBusinessAdmin }));
vi.mock("@/modules/collections/collectors", () => ({
  createCollector,
  deactivateCollector,
  reactivateCollector,
  resetCollectorPassword,
}));
vi.mock("@/shared/database/pg-pool", () => ({ getPool: () => "pool" }));
vi.mock("@/shared/database/supabase-admin", () => ({ createSupabaseAdminClient: () => "admin" }));
vi.mock("@/shared/validation/env", () => ({
  getServerEnv: () => ({ syntheticEmailDomain: "d.test" }),
}));

const ID = "4f9d2d7e-1c34-4a55-9b0e-8c2d1e7f6a10";

const request = (body?: unknown) =>
  new Request("https://app.cuadre.test/api/negocio/cobradores", {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

afterEach(() => vi.resetAllMocks());

describe("POST /api/negocio/cobradores", () => {
  it("autoriza antes de validar; valida nombre y usuario; crea (201) sin aceptar negocio del cliente", async () => {
    requireSession.mockResolvedValue({ userId: "u" });
    const { POST } = await import("./route");

    authorizeBusinessAdmin.mockRejectedValueOnce(new AppError("FORBIDDEN", "No", 403));
    expect((await POST(request({}))).status).toBe(403);
    expect(createCollector).not.toHaveBeenCalled();

    authorizeBusinessAdmin.mockResolvedValue("b-1");
    createCollector.mockResolvedValue({ collectorId: "c", temporaryPassword: "x" });
    for (const body of [{}, { name: "  ", username: "cob.uno" }, { name: "Ana", username: "" }]) {
      expect((await POST(request(body))).status, JSON.stringify(body)).toBe(400);
    }
    const ok = await POST(request({ name: " Ana ", username: "cob.uno", businessId: "otro" }));
    expect(ok.status).toBe(201);
    expect(createCollector).toHaveBeenCalledWith(
      expect.objectContaining({ db: "pool" }),
      { userId: "u" },
      { name: "Ana", username: "cob.uno" },
    );
  });
});

describe("POST /api/negocio/cobradores/[collectorId]/[action]", () => {
  const call = async (collectorId: string, action: string) => {
    const { POST } = await import("./[collectorId]/[action]/route");
    return POST(request(), { params: Promise.resolve({ collectorId, action }) });
  };

  it("autoriza primero; id o acción inválidos son 404; cada acción llama a su comando", async () => {
    requireSession.mockResolvedValue({ userId: "u" });
    authorizeBusinessAdmin.mockRejectedValueOnce(new AppError("FORBIDDEN", "No", 403));
    expect((await call("no-uuid", "borrar")).status).toBe(403);

    authorizeBusinessAdmin.mockResolvedValue("b-1");
    expect((await call("no-uuid", "desactivar")).status).toBe(404);
    expect((await call(ID, "borrar")).status).toBe(404);
    expect((await call(ID, "constructor")).status).toBe(404);

    deactivateCollector.mockResolvedValue({ collectorId: ID });
    reactivateCollector.mockResolvedValue({ collectorId: ID });
    resetCollectorPassword.mockResolvedValue({ collectorId: ID });
    expect((await call(ID, "desactivar")).status).toBe(200);
    expect((await call(ID, "reactivar")).status).toBe(200);
    expect((await call(ID, "restablecer")).status).toBe(200);
    expect(deactivateCollector).toHaveBeenCalledTimes(1);
    expect(reactivateCollector).toHaveBeenCalledTimes(1);
    expect(resetCollectorPassword).toHaveBeenCalledTimes(1);
  });
});
