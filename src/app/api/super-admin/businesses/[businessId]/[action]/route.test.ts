import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/shared/errors/app-error";

// Cablea el Route Handler del ciclo de vida con dobles: el flujo real contra Auth y BD está en
// integración (business-lifecycle.test.ts). Aquí solo se prueba el orden de las comprobaciones, qué
// servicio se invoca con qué argumentos y el mapeo HTTP.

const requireSession = vi.fn();
const authorizeLifecycle = vi.fn();
const services = {
  suspendBusiness: vi.fn(),
  activateBusiness: vi.fn(),
  archiveBusiness: vi.fn(),
  changePlan: vi.fn(),
  resubscribeBusiness: vi.fn(),
};

vi.mock("@/modules/identity/require-session", () => ({ requireSession }));
vi.mock("@/modules/subscriptions/lifecycle", () => ({ ...services, authorizeLifecycle }));
vi.mock("@/shared/database/pg-pool", () => ({ getPool: () => "pool" }));

const BUSINESS_ID = "3f2b8c1e-9a4d-4b6f-8e2a-1c7d5f0a9b34";
const actor = { userId: "u-1", role: "SUPER_ADMIN" };
const result = {
  businessId: BUSINESS_ID,
  accessStatus: "SUSPENDIDO",
  subscription: { id: "s-1", planCode: "MENSUAL", status: "SUSPENDIDA" },
};

async function call(
  action: string,
  body: unknown,
  options: { businessId?: string; headers?: Record<string, string> } = {},
) {
  const { POST } = await import("./route");
  const request = new Request(
    `https://app.cuadre.test/api/super-admin/businesses/${options.businessId ?? BUSINESS_ID}/${action}`,
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
  return POST(request, {
    params: Promise.resolve({ businessId: options.businessId ?? BUSINESS_ID, action }),
  });
}

afterEach(() => {
  vi.resetAllMocks();
});

describe("POST /api/super-admin/businesses/[businessId]/[action]", () => {
  it("rechaza una petición cross-site antes de tocar la sesión (403)", async () => {
    const res = await call("suspend", {}, { headers: { "sec-fetch-site": "cross-site" } });

    expect(res.status).toBe(403);
    expect(requireSession).not.toHaveBeenCalled();
  });

  it("sin sesión responde 401 y no llama a ningún servicio", async () => {
    requireSession.mockRejectedValue(new AppError("UNAUTHENTICATED", "Inicia sesión", 401));

    const res = await call("suspend", {});

    expect(res.status).toBe(401);
    for (const service of Object.values(services)) expect(service).not.toHaveBeenCalled();
  });

  it("con contraseña temporal pendiente, requireSession lo detiene (403)", async () => {
    requireSession.mockRejectedValue(
      new AppError("PASSWORD_CHANGE_REQUIRED", "Debes cambiar tu contraseña", 403),
    );

    const res = await call("archive", { reason: "Baja" });

    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("PASSWORD_CHANGE_REQUIRED");
    expect(services.archiveBusiness).not.toHaveBeenCalled();
  });

  it("una acción desconocida es 404 sin autorizar ni invocar nada", async () => {
    requireSession.mockResolvedValue(actor);

    const res = await call("explotar", {});

    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("UNKNOWN_ACTION");
    expect(authorizeLifecycle).not.toHaveBeenCalled();
  });

  it("un actor sin permiso recibe 403 aunque el id o el cuerpo sean inválidos (autoriza antes de validar)", async () => {
    requireSession.mockResolvedValue({ userId: "u-2", role: "ADMIN_NEGOCIO" });
    authorizeLifecycle.mockRejectedValue(new AppError("FORBIDDEN", "No tienes permiso", 403));

    for (const [action, body, businessId] of [
      ["archive", {}, undefined],
      ["plan", { planCode: "TRIMESTRAL" }, undefined],
      ["suspend", {}, "no-es-uuid"],
    ] as const) {
      const res = await call(action, body, { businessId });
      expect(res.status, action).toBe(403);
    }
    for (const service of Object.values(services)) expect(service).not.toHaveBeenCalled();
  });

  it("un id inválido se autoriza contra el UUID nulo (no deja evento de auditoría)", async () => {
    requireSession.mockResolvedValue(actor);

    await call("suspend", {}, { businessId: "no-es-uuid" });

    expect(authorizeLifecycle).toHaveBeenCalledWith(
      { db: "pool" },
      actor,
      "SUSPEND",
      "00000000-0000-0000-0000-000000000000",
    );
  });

  it("un id de negocio que no es UUID es 400 sin llamar al servicio", async () => {
    requireSession.mockResolvedValue(actor);

    const res = await call("suspend", {}, { businessId: "no-es-uuid" });

    expect(res.status).toBe(400);
    expect(services.suspendBusiness).not.toHaveBeenCalled();
  });

  // [acción de la URL, servicio esperado, cuerpo enviado, entrada que debe recibir el servicio]
  const cases: [string, keyof typeof services, unknown, unknown, string][] = [
    ["suspend", "suspendBusiness", { note: "Falta de pago" }, { note: "Falta de pago" }, "SUSPEND"],
    ["activate", "activateBusiness", {}, {}, "ACTIVATE"],
    ["archive", "archiveBusiness", { reason: "Cierre" }, { reason: "Cierre" }, "ARCHIVE"],
    ["plan", "changePlan", { planCode: "ANUAL" }, { planCode: "ANUAL" }, "CHANGE_PLAN"],
    [
      "resubscribe",
      "resubscribeBusiness",
      { planCode: "SEMANAL", note: "Vuelve" },
      { planCode: "SEMANAL", note: "Vuelve" },
      "RESUBSCRIBE",
    ],
  ];

  for (const [action, service, body, expectedInput, command] of cases) {
    it(`${action} invoca ${service} con el negocio de la URL y responde 200 sin caché`, async () => {
      requireSession.mockResolvedValue(actor);
      services[service].mockResolvedValue(result);

      const res = await call(action, body);

      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({ ok: true, data: result });
      expect(authorizeLifecycle).toHaveBeenCalledWith({ db: "pool" }, actor, command, BUSINESS_ID);
      expect(services[service]).toHaveBeenCalledWith({ db: "pool" }, actor, {
        businessId: BUSINESS_ID,
        ...(expectedInput as object),
      });
      for (const [name, other] of Object.entries(services)) {
        if (name !== service) expect(other, name).not.toHaveBeenCalled();
      }
    });
  }

  it("cuerpos inválidos dan 400 sin llamar al servicio", async () => {
    requireSession.mockResolvedValue(actor);
    const invalid: [string, unknown][] = [
      ["archive", {}], // el motivo es obligatorio
      ["archive", { reason: "" }],
      ["plan", {}],
      ["plan", { planCode: "TRIMESTRAL" }],
      ["resubscribe", { planCode: 3 }],
      ["suspend", { note: "x".repeat(501) }],
      ["suspend", { note: "con \u0000 nulo" }],
    ];

    for (const [action, body] of invalid) {
      const res = await call(action, body);
      expect(res.status, `${action} ${JSON.stringify(body)}`).toBe(400);
    }
    for (const service of Object.values(services)) expect(service).not.toHaveBeenCalled();
  });

  it("no acepta un `businessId` ni un actor en el cuerpo: el negocio sale solo de la URL", async () => {
    requireSession.mockResolvedValue(actor);
    services.suspendBusiness.mockResolvedValue(result);

    await call("suspend", {
      note: "x",
      businessId: crypto.randomUUID(),
      actor: { role: "SUPER_ADMIN" },
    });

    expect(services.suspendBusiness).toHaveBeenCalledWith({ db: "pool" }, actor, {
      businessId: BUSINESS_ID,
      note: "x",
    });
  });

  it("los errores del servicio conservan su código y estado (409, 404, 403)", async () => {
    requireSession.mockResolvedValue(actor);
    const failures: [AppError, number][] = [
      [new AppError("INVALID_STATE_TRANSITION", "No se puede", 409), 409],
      [new AppError("BUSINESS_NOT_FOUND", "El negocio no existe", 404), 404],
      [new AppError("FORBIDDEN", "No tienes permiso", 403), 403],
    ];

    for (const [error, status] of failures) {
      services.suspendBusiness.mockRejectedValueOnce(error);
      const res = await call("suspend", {});
      expect(res.status).toBe(status);
      expect((await res.json()).error.code).toBe(error.code);
    }
  });
});
