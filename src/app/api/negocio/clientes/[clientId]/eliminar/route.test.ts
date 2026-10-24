import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/shared/errors/app-error";

// Orden y mapeo HTTP de la eliminación de clientes; el flujo real se cubre en integración
// (clients-decisions.test.ts).

const requireSession = vi.fn();
const authorizeBusinessAdmin = vi.fn();
const deleteClient = vi.fn();

vi.mock("@/modules/identity/require-session", () => ({ requireSession }));
vi.mock("@/modules/identity/authorize-business-admin", () => ({ authorizeBusinessAdmin }));
vi.mock("@/modules/portfolio/clients", () => ({ deleteClient }));
vi.mock("@/shared/database/pg-pool", () => ({ getPool: () => "pool" }));

const CLIENT_ID = "6f1c2b8e-1d2a-4c3b-9e4f-5a6b7c8d9e0f";

async function post(clientId: string, headers: Record<string, string> = {}) {
  const { POST } = await import("./route");
  return POST(
    new Request(`https://app.cuadre.test/api/negocio/clientes/${clientId}/eliminar`, {
      method: "POST",
      headers: { "sec-fetch-site": "same-origin", ...headers },
    }),
    { params: Promise.resolve({ clientId }) },
  );
}

afterEach(() => {
  vi.resetAllMocks();
});

describe("POST /api/negocio/clientes/[clientId]/eliminar", () => {
  it("rechaza una petición cross-site antes de tocar la sesión", async () => {
    const res = await post(CLIENT_ID, { "sec-fetch-site": "cross-site" });
    expect(res.status).toBe(403);
    expect(requireSession).not.toHaveBeenCalled();
  });

  it("autoriza antes de validar el id: sin permiso es 403 aunque el id sea inválido", async () => {
    requireSession.mockResolvedValue({ userId: "u" });
    authorizeBusinessAdmin.mockRejectedValue(
      new AppError("FORBIDDEN", "No tienes permiso para esta operación", 403),
    );

    const res = await post("no-es-uuid");

    expect(res.status).toBe(403);
    expect(deleteClient).not.toHaveBeenCalled();
  });

  it("con permiso, un id inválido es 404 y uno válido elimina; el historial se traduce a 409", async () => {
    requireSession.mockResolvedValue({ userId: "u" });
    authorizeBusinessAdmin.mockResolvedValue("b-1");

    expect((await post("no-es-uuid")).status).toBe(404);
    expect(deleteClient).not.toHaveBeenCalled();

    deleteClient.mockResolvedValueOnce({ clientId: CLIENT_ID });
    const ok = await post(CLIENT_ID);
    expect(ok.status).toBe(200);
    expect(deleteClient).toHaveBeenCalledWith({ db: "pool" }, { userId: "u" }, CLIENT_ID);

    deleteClient.mockRejectedValueOnce(
      new AppError("CLIENT_HAS_HISTORY", "El cliente tiene contratos o préstamos", 409),
    );
    expect((await post(CLIENT_ID)).status).toBe(409);
  });
});
