import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/shared/errors/app-error";

// Cablea el Route Handler con dobles: el flujo real contra Auth y BD está en integración
// (reset-admin-password.test.ts). Aquí se prueba el orden de las comprobaciones y el mapeo HTTP.

const requireSession = vi.fn();
const authorizeSuperAdminOnBusiness = vi.fn();
const resetAdminPassword = vi.fn();

vi.mock("@/modules/identity/require-session", () => ({ requireSession }));
vi.mock("@/modules/identity/authorize-super-admin", () => ({ authorizeSuperAdminOnBusiness }));
vi.mock("@/modules/identity/reset-admin-password", () => ({ resetAdminPassword }));
vi.mock("@/shared/database/pg-pool", () => ({ getPool: () => "pool" }));
vi.mock("@/shared/database/supabase-admin", () => ({
  createSupabaseAdminClient: () => "admin-client",
}));

const BUSINESS_ID = "3f2b8c1e-9a4d-4b6f-8e2a-1c7d5f0a9b34";
const actor = { userId: "u-1", role: "SUPER_ADMIN" };
const result = {
  businessId: BUSINESS_ID,
  admin: { userId: "u-2", username: "admin.ejemplo" },
  temporaryPassword: "Clave1234",
};

async function call(
  body: unknown = {},
  options: { businessId?: string; headers?: Record<string, string> } = {},
) {
  const { POST } = await import("./route");
  const businessId = options.businessId ?? BUSINESS_ID;
  const request = new Request(
    `https://app.cuadre.test/api/super-admin/businesses/${businessId}/admin-password`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "sec-fetch-site": "same-origin",
        ...options.headers,
      },
      body: JSON.stringify(body),
    },
  );
  return POST(request, { params: Promise.resolve({ businessId }) });
}

afterEach(() => {
  vi.resetAllMocks();
});

describe("POST /api/super-admin/businesses/[businessId]/admin-password", () => {
  it("rechaza una petición cross-site antes de tocar la sesión (403)", async () => {
    const res = await call({}, { headers: { "sec-fetch-site": "cross-site" } });

    expect(res.status).toBe(403);
    expect(requireSession).not.toHaveBeenCalled();
  });

  it("sin sesión responde 401 y no restablece nada", async () => {
    requireSession.mockRejectedValue(new AppError("UNAUTHENTICATED", "Inicia sesión", 401));

    const res = await call();

    expect(res.status).toBe(401);
    expect(resetAdminPassword).not.toHaveBeenCalled();
  });

  it("un actor sin permiso recibe 403 aunque el id o el cuerpo sean inválidos (autoriza antes de validar)", async () => {
    requireSession.mockResolvedValue({ userId: "u-2", role: "ADMIN_NEGOCIO" });
    authorizeSuperAdminOnBusiness.mockRejectedValue(
      new AppError("FORBIDDEN", "No tienes permiso", 403),
    );

    expect((await call({ cualquier: "cosa" })).status).toBe(403);
    expect((await call({}, { businessId: "no-es-uuid" })).status).toBe(403);
    expect(resetAdminPassword).not.toHaveBeenCalled();
  });

  it("un id inválido se autoriza contra el UUID nulo y luego da 400", async () => {
    requireSession.mockResolvedValue(actor);

    const res = await call({}, { businessId: "no-es-uuid" });

    expect(res.status).toBe(400);
    expect(authorizeSuperAdminOnBusiness).toHaveBeenCalledWith(
      "pool",
      actor,
      "ContrasenaRestablecida",
      "00000000-0000-0000-0000-000000000000",
    );
    expect(resetAdminPassword).not.toHaveBeenCalled();
  });

  it("no acepta datos en el cuerpo: el objetivo sale solo de la URL", async () => {
    requireSession.mockResolvedValue(actor);

    for (const body of [
      { userId: crypto.randomUUID() },
      { businessId: crypto.randomUUID() },
      { password: "Elegida2026" },
    ]) {
      expect((await call(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(resetAdminPassword).not.toHaveBeenCalled();
  });

  it("con permiso restablece y responde 200 sin caché con la contraseña temporal", async () => {
    requireSession.mockResolvedValue(actor);
    resetAdminPassword.mockResolvedValue(result);

    const res = await call();

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true, data: result });
    expect(resetAdminPassword).toHaveBeenCalledWith({ db: "pool", admin: "admin-client" }, actor, {
      businessId: BUSINESS_ID,
    });
  });

  it("los errores del servicio conservan código y estado (404, 409, 503) sin filtrar la contraseña", async () => {
    requireSession.mockResolvedValue(actor);
    const failures: [AppError, number][] = [
      [new AppError("BUSINESS_NOT_FOUND", "El negocio no existe", 404), 404],
      [new AppError("USER_BLOCKED", "La cuenta está bloqueada", 409), 409],
      [new AppError("AUTH_UNAVAILABLE", "No se pudo restablecer", 503), 503],
    ];

    for (const [error, status] of failures) {
      resetAdminPassword.mockRejectedValueOnce(error);
      const res = await call();
      expect(res.status).toBe(status);
      const text = await res.text();
      expect(text).toContain(error.code);
      expect(text).not.toContain("temporaryPassword");
    }
  });
});
