import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/shared/errors/app-error";

// Orden y mapeo HTTP de las rutas de clientes; el flujo real se cubre en integración (clients.test.ts).

const requireSession = vi.fn();
const authorizeBusinessAdmin = vi.fn();
const createClient = vi.fn();

vi.mock("@/modules/identity/require-session", () => ({ requireSession }));
vi.mock("@/modules/identity/authorize-business-admin", () => ({ authorizeBusinessAdmin }));
vi.mock("@/modules/portfolio/clients", () => ({ createClient, updateClient: vi.fn() }));
vi.mock("@/shared/database/pg-pool", () => ({ getPool: () => "pool" }));

async function post(body: unknown, headers: Record<string, string> = {}) {
  const { POST } = await import("./route");
  return POST(
    new Request("https://app.cuadre.test/api/negocio/clientes", {
      method: "POST",
      headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

afterEach(() => {
  vi.resetAllMocks();
});

describe("POST /api/negocio/clientes", () => {
  it("rechaza una petición cross-site antes de tocar la sesión", async () => {
    const res = await post({}, { "sec-fetch-site": "cross-site" });
    expect(res.status).toBe(403);
    expect(requireSession).not.toHaveBeenCalled();
  });

  it("autoriza antes de validar: sin permiso es 403 aunque el cuerpo sea inválido", async () => {
    requireSession.mockResolvedValue({ userId: "u" });
    authorizeBusinessAdmin.mockRejectedValue(
      new AppError("FORBIDDEN", "No tienes permiso para esta operación", 403),
    );

    const res = await post({ nombre: "mal formato" });

    expect(res.status).toBe(403);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("con permiso, un cuerpo inválido es 400 y uno válido crea (201) sin aceptar un negocio del cliente", async () => {
    requireSession.mockResolvedValue({ userId: "u" });
    authorizeBusinessAdmin.mockResolvedValue("b-1");
    createClient.mockResolvedValue({ id: "c-1" });

    expect((await post({ name: "", identification: "1" })).status).toBe(400);
    expect(createClient).not.toHaveBeenCalled();

    const res = await post({ name: " Ana ", identification: " 1 ", businessId: "otro" });
    expect(res.status).toBe(201);
    expect(createClient).toHaveBeenCalledWith(
      { db: "pool" },
      { userId: "u" },
      { name: "Ana", identification: "1" },
    );
  });
});
