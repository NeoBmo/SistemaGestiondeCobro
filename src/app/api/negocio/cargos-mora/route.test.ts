import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/shared/errors/app-error";

// Orden y mapeo HTTP de las rutas de cargos de mora; el flujo real se cubre en integración (late-fees.test.ts).

const requireSession = vi.fn();
const authorizeBusinessAdmin = vi.fn();
const createLateFee = vi.fn();
const voidLateFee = vi.fn();

vi.mock("@/modules/identity/require-session", () => ({ requireSession }));
vi.mock("@/modules/identity/authorize-business-admin", () => ({ authorizeBusinessAdmin }));
vi.mock("@/modules/portfolio/late-fees", () => ({ createLateFee, voidLateFee }));
vi.mock("@/shared/database/pg-pool", () => ({ getPool: () => "pool" }));

const KEY = "0b6f6e1c-6c51-4e9a-8d2b-3f1a2b3c4d5e";
const LOAN = "4f9d2d7e-1c34-4a55-9b0e-8c2d1e7f6a10";
const CHARGE = "7a1c3f20-2b44-4c66-8d1e-9f0a1b2c3d4e";

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://app.cuadre.test/api/negocio/cargos-mora", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      "idempotency-key": KEY,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.resetAllMocks();
});

describe("POST /api/negocio/cargos-mora", () => {
  it("autoriza antes de validar", async () => {
    requireSession.mockResolvedValue({ userId: "u" });
    authorizeBusinessAdmin.mockRejectedValue(new AppError("FORBIDDEN", "No tienes permiso", 403));
    const { POST } = await import("./route");

    expect((await POST(request({}, { "idempotency-key": "mala" }))).status).toBe(403);
    expect(createLateFee).not.toHaveBeenCalled();
  });

  it("exige motivo e importe entero positivo (400) y con todo válido crea (201), descartando el negocio del cliente", async () => {
    requireSession.mockResolvedValue({ userId: "u" });
    authorizeBusinessAdmin.mockResolvedValue("b-1");
    createLateFee.mockResolvedValue({ result: { chargeId: CHARGE }, replayed: false });
    const { POST } = await import("./route");

    for (const body of [
      { loanId: LOAN, amount: 100 },
      { loanId: LOAN, amount: 100, reason: "  " },
      { loanId: LOAN, amount: 0, reason: "x" },
      { loanId: LOAN, amount: 1.5, reason: "x" },
      { loanId: "no-uuid", amount: 100, reason: "x" },
    ]) {
      expect((await POST(request(body))).status, JSON.stringify(body)).toBe(400);
    }
    expect(createLateFee).not.toHaveBeenCalled();

    const ok = await POST(
      request({ loanId: LOAN, amount: 100, reason: " Atraso ", businessId: "otro" }),
    );
    expect(ok.status).toBe(201);
    expect(createLateFee).toHaveBeenCalledWith(
      { db: "pool" },
      { userId: "u" },
      { loanId: LOAN, amount: 100, reason: "Atraso", idempotencyKey: KEY },
    );
  });
});

describe("POST /api/negocio/cargos-mora/[chargeId]/anular", () => {
  async function voidIt(body: unknown, chargeId = CHARGE, headers: Record<string, string> = {}) {
    const { POST } = await import("./[chargeId]/anular/route");
    return POST(request(body, headers), { params: Promise.resolve({ chargeId }) });
  }

  it("autoriza antes de validar; id inválido es 404; sin motivo es 400; válido anula", async () => {
    requireSession.mockResolvedValue({ userId: "u" });
    authorizeBusinessAdmin.mockRejectedValueOnce(
      new AppError("FORBIDDEN", "No tienes permiso", 403),
    );
    expect((await voidIt({}, "no-uuid", { "idempotency-key": "mala" })).status).toBe(403);

    authorizeBusinessAdmin.mockResolvedValue("b-1");
    voidLateFee.mockResolvedValue({ result: { chargeId: CHARGE }, replayed: false });
    expect((await voidIt({ reason: "x" }, "no-uuid")).status).toBe(404);
    expect((await voidIt({ reason: "  " })).status).toBe(400);
    expect(voidLateFee).not.toHaveBeenCalled();

    expect((await voidIt({ reason: " Error " })).status).toBe(200);
    expect(voidLateFee).toHaveBeenCalledWith(
      { db: "pool" },
      { userId: "u" },
      { idempotencyKey: KEY, chargeId: CHARGE, reason: "Error" },
    );
  });
});
