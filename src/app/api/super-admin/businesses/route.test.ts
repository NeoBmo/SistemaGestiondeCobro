import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/shared/errors/app-error";

// Cablea el Route Handler con dobles: el flujo real (Auth/BD/Supabase) se cubre en integración
// (create-business.test.ts) y en e2e (T1.6). Aquí solo se prueba el orden y el mapeo HTTP.

const requireSession = vi.fn();
const createBusiness = vi.fn();

vi.mock("@/modules/identity/require-session", () => ({ requireSession }));
vi.mock("@/modules/subscriptions/create-business", () => ({ createBusiness }));
vi.mock("@/shared/database/pg-pool", () => ({ getPool: () => "pool" }));
vi.mock("@/shared/database/supabase-admin", () => ({
  createSupabaseAdminClient: () => "admin-client",
}));
vi.mock("@/shared/validation/env", () => ({
  getServerEnv: () => ({ syntheticEmailDomain: "cuadre.invalid" }),
}));

async function importRoute() {
  return import("./route");
}

function jsonRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://app.cuadre.test/api/super-admin/businesses", {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers },
    body: JSON.stringify(body),
  });
}

const validBody = {
  name: "Prestamos Ejemplo",
  ownerName: "Ana Responsable",
  ownerIdentification: "123",
  phone: "3000000000",
  planCode: "MENSUAL",
  adminUsername: "admin.ejemplo",
};

afterEach(() => {
  vi.resetAllMocks();
});

describe("POST /api/super-admin/businesses", () => {
  it("rechaza una petición cross-site antes de tocar la sesión (403)", async () => {
    const { POST } = await importRoute();

    const res = await POST(jsonRequest(validBody, { "sec-fetch-site": "cross-site" }));

    expect(res.status).toBe(403);
    expect(requireSession).not.toHaveBeenCalled();
  });

  it("sin sesión responde 401 sin haber validado el cuerpo", async () => {
    requireSession.mockRejectedValue(
      new AppError("UNAUTHENTICATED", "Inicia sesión para continuar", 401),
    );
    const { POST } = await importRoute();

    const res = await POST(jsonRequest({ malformado: true }));

    expect(res.status).toBe(401);
    expect(createBusiness).not.toHaveBeenCalled();
  });

  it("exige el rol Super Admin (403) antes de crear nada", async () => {
    requireSession.mockRejectedValue(
      new AppError("FORBIDDEN", "No tienes permiso para esta operación", 403),
    );
    const { POST } = await importRoute();

    const res = await POST(jsonRequest(validBody));

    expect(res.status).toBe(403);
    expect(createBusiness).not.toHaveBeenCalled();
  });

  it("un cuerpo inválido da 400 sin llamar a createBusiness", async () => {
    requireSession.mockResolvedValue({ userId: "u-1", role: "SUPER_ADMIN" });
    const { POST } = await importRoute();

    const res = await POST(jsonRequest({ ...validBody, planCode: "TRIMESTRAL" }));

    expect(res.status).toBe(400);
    expect(createBusiness).not.toHaveBeenCalled();
  });

  it("con sesión y cuerpo válidos, crea el negocio y responde 201 sin caché", async () => {
    const actor = { userId: "u-1", role: "SUPER_ADMIN" };
    requireSession.mockResolvedValue(actor);
    createBusiness.mockResolvedValue({
      businessId: "b-1",
      subscriptionId: "s-1",
      admin: { userId: "u-2", username: "admin.ejemplo" },
      temporaryPassword: "Clave1234",
    });
    const { POST } = await importRoute();

    const res = await POST(jsonRequest(validBody));

    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(createBusiness).toHaveBeenCalledWith(
      { db: "pool", admin: "admin-client", syntheticEmailDomain: "cuadre.invalid" },
      actor,
      expect.objectContaining({ adminUsername: "admin.ejemplo" }),
    );
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      data: {
        businessId: "b-1",
        subscriptionId: "s-1",
        admin: { userId: "u-2", username: "admin.ejemplo" },
        temporaryPassword: "Clave1234",
      },
    });
  });

  it("un conflicto del servicio (usuario en uso) se propaga como 409", async () => {
    requireSession.mockResolvedValue({ userId: "u-1", role: "SUPER_ADMIN" });
    createBusiness.mockRejectedValue(
      new AppError("USERNAME_TAKEN", "Ese nombre de usuario ya está en uso. Elige otro", 409),
    );
    const { POST } = await importRoute();

    const res = await POST(jsonRequest(validBody));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      ok: false,
      error: {
        code: "USERNAME_TAKEN",
        message: "Ese nombre de usuario ya está en uso. Elige otro",
      },
    });
  });
});
