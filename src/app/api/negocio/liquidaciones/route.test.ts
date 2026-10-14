import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/shared/errors/app-error";

// Orden y mapeo HTTP de la liquidación; el flujo real se cubre en integración (settlements.test.ts).

const requireSession = vi.fn();
const authorizeBusinessAdmin = vi.fn();
const authorizeCollector = vi.fn();
const confirmSettlement = vi.fn();
const resolveDifference = vi.fn();
const declareSettlement = vi.fn();

vi.mock("@/modules/identity/require-session", () => ({ requireSession }));
vi.mock("@/modules/identity/authorize-business-admin", () => ({ authorizeBusinessAdmin }));
vi.mock("@/modules/identity/authorize-collector", () => ({ authorizeCollector }));
vi.mock("@/modules/collections/settlements", () => ({
  confirmSettlement,
  resolveDifference,
  declareSettlement,
}));
vi.mock("@/shared/database/pg-pool", () => ({ getPool: () => "pool" }));

const KEY = "0b6f6e1c-6c51-4e9a-8d2b-3f1a2b3c4d5e";
const ID = "4f9d2d7e-1c34-4a55-9b0e-8c2d1e7f6a10";

const request = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://app.cuadre.test/api/x", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      "idempotency-key": KEY,
      ...headers,
    },
    body: JSON.stringify(body),
  });

afterEach(() => vi.resetAllMocks());

describe("POST /api/negocio/liquidaciones/[settlementId]/[action]", () => {
  const call = async (settlementId: string, action: string, body: unknown, headers = {}) => {
    const { POST } = await import("./[settlementId]/[action]/route");
    return POST(request(body, headers), { params: Promise.resolve({ settlementId, action }) });
  };

  it("autoriza antes de validar; id o acción inválidos son 404; valida los cuerpos", async () => {
    requireSession.mockResolvedValue({ userId: "u" });
    authorizeBusinessAdmin.mockRejectedValueOnce(new AppError("FORBIDDEN", "No", 403));
    expect((await call("no-uuid", "x", {}, { "idempotency-key": "mala" })).status).toBe(403);

    authorizeBusinessAdmin.mockResolvedValue("b-1");
    confirmSettlement.mockResolvedValue({ result: { status: "CUADRADA" }, replayed: false });
    resolveDifference.mockResolvedValue({ result: { amount: 1 }, replayed: false });
    expect((await call("no-uuid", "confirmar", { receivedAmount: 0 })).status).toBe(404);
    expect((await call(ID, "borrar", {})).status).toBe(404);
    expect((await call(ID, "constructor", {})).status).toBe(404);
    expect((await call(ID, "confirmar", { receivedAmount: -1 })).status).toBe(400);
    expect((await call(ID, "confirmar", { receivedAmount: 1.5 })).status).toBe(400);
    expect((await call(ID, "resolver", { note: "  " })).status).toBe(400);
    expect(
      (await call(ID, "confirmar", { receivedAmount: 0 }, { "idempotency-key": "mala" })).status,
    ).toBe(400);

    expect(
      (await call(ID, "confirmar", { receivedAmount: 100, observation: " ok ", extra: 1 })).status,
    ).toBe(200);
    expect(confirmSettlement).toHaveBeenCalledWith(
      { db: "pool" },
      { userId: "u" },
      { receivedAmount: 100, observation: "ok", settlementId: ID, idempotencyKey: KEY },
    );
    expect((await call(ID, "resolver", { note: "Repuesto" })).status).toBe(200);
  });
});

describe("POST /api/cobrador/liquidacion", () => {
  it("autoriza antes de validar y acepta cero como importe entregado", async () => {
    requireSession.mockResolvedValue({ userId: "u" });
    const { POST } = await import("../../cobrador/liquidacion/route");
    authorizeCollector.mockRejectedValueOnce(new AppError("FORBIDDEN", "No", 403));
    expect((await POST(request({}, { "idempotency-key": "mala" }))).status).toBe(403);
    expect(declareSettlement).not.toHaveBeenCalled();

    authorizeCollector.mockResolvedValue("b-1");
    declareSettlement.mockResolvedValue({ result: { settlementId: "s" }, replayed: false });
    expect((await POST(request({ declaredAmount: -1 }))).status).toBe(400);
    expect((await POST(request({ declaredAmount: 10.5 }))).status).toBe(400);
    expect((await POST(request({ declaredAmount: 0 }))).status).toBe(201);
  });
});
