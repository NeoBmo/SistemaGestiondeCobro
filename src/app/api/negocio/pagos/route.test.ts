import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/shared/errors/app-error";

// Orden y mapeo HTTP de las rutas de pagos; el flujo real se cubre en integración (payments.test.ts).

const requireSession = vi.fn();
const authorizeBusinessAdmin = vi.fn();
const registerPayment = vi.fn();
const reversePayment = vi.fn();

vi.mock("@/modules/identity/require-session", () => ({ requireSession }));
vi.mock("@/modules/identity/authorize-business-admin", () => ({ authorizeBusinessAdmin }));
vi.mock("@/modules/portfolio/payments", () => ({ registerPayment, reversePayment }));
vi.mock("@/shared/database/pg-pool", () => ({ getPool: () => "pool" }));

const KEY = "0b6f6e1c-6c51-4e9a-8d2b-3f1a2b3c4d5e";
const LOAN = "4f9d2d7e-1c34-4a55-9b0e-8c2d1e7f6a10";
const PAYMENT = "7a1c3f20-2b44-4c66-8d1e-9f0a1b2c3d4e";

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://app.cuadre.test/api/negocio/pagos", {
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

describe("POST /api/negocio/pagos", () => {
  it("autoriza antes de validar: un cobrador recibe 403 aunque la clave y el cuerpo sean inválidos", async () => {
    requireSession.mockResolvedValue({ userId: "u" });
    authorizeBusinessAdmin.mockRejectedValue(new AppError("FORBIDDEN", "No tienes permiso", 403));
    const { POST } = await import("./route");

    const res = await POST(request({}, { "idempotency-key": "mala" }));

    expect(res.status).toBe(403);
    expect(registerPayment).not.toHaveBeenCalled();
  });

  it("exige clave válida y un importe entero positivo (400)", async () => {
    requireSession.mockResolvedValue({ userId: "u" });
    authorizeBusinessAdmin.mockResolvedValue("b-1");
    const { POST } = await import("./route");

    expect(
      (await POST(request({ loanId: LOAN, amount: 10 }, { "idempotency-key": "mala" }))).status,
    ).toBe(400);
    for (const amount of [0, -5, 1.5, "10", null]) {
      expect((await POST(request({ loanId: LOAN, amount }))).status, String(amount)).toBe(400);
    }
    expect((await POST(request({ loanId: "no-uuid", amount: 10 }))).status).toBe(400);
    expect(registerPayment).not.toHaveBeenCalled();
  });

  it("un pago nuevo responde 201 y un reenvío 200; el 409 de exceso se propaga y el negocio del cliente se ignora", async () => {
    requireSession.mockResolvedValue({ userId: "u" });
    authorizeBusinessAdmin.mockResolvedValue("b-1");
    registerPayment.mockResolvedValueOnce({ result: { paymentId: PAYMENT }, replayed: false });
    registerPayment.mockResolvedValueOnce({ result: { paymentId: PAYMENT }, replayed: true });
    const { POST } = await import("./route");

    const created = await POST(request({ loanId: LOAN, amount: 100, businessId: "otro" }));
    const again = await POST(request({ loanId: LOAN, amount: 100 }));
    expect(created.status).toBe(201);
    expect(again.status).toBe(200);
    expect((await again.json()).data.replayed).toBe(true);
    expect(registerPayment).toHaveBeenCalledWith(
      { db: "pool" },
      { userId: "u" },
      { loanId: LOAN, amount: 100, idempotencyKey: KEY },
    );

    registerPayment.mockRejectedValueOnce(
      new AppError("PAYMENT_EXCEEDS_BALANCE", "El pago supera el saldo", 409),
    );
    const exceeded = await POST(request({ loanId: LOAN, amount: 999 }));
    expect(exceeded.status).toBe(409);
  });
});

describe("POST /api/negocio/pagos/[paymentId]/reversar", () => {
  async function reverse(body: unknown, paymentId = PAYMENT, headers: Record<string, string> = {}) {
    const { POST } = await import("./[paymentId]/reversar/route");
    return POST(request(body, headers), { params: Promise.resolve({ paymentId }) });
  }

  it("autoriza antes de validar el id, la clave y el motivo", async () => {
    requireSession.mockResolvedValue({ userId: "u" });
    authorizeBusinessAdmin.mockRejectedValue(new AppError("FORBIDDEN", "No tienes permiso", 403));

    const res = await reverse({}, "no-uuid", { "idempotency-key": "mala" });

    expect(res.status).toBe(403);
    expect(reversePayment).not.toHaveBeenCalled();
  });

  it("id inválido es 404; sin motivo o con motivo largo es 400; válido reversa", async () => {
    requireSession.mockResolvedValue({ userId: "u" });
    authorizeBusinessAdmin.mockResolvedValue("b-1");
    reversePayment.mockResolvedValue({ result: { reversalId: "r-1" }, replayed: false });

    expect((await reverse({ reason: "x" }, "no-uuid")).status).toBe(404);
    expect((await reverse({ reason: "  " })).status).toBe(400);
    expect((await reverse({ reason: "x".repeat(501) })).status).toBe(400);
    expect((await reverse({ reason: "x" }, PAYMENT, { "idempotency-key": "mala" })).status).toBe(
      400,
    );
    expect(reversePayment).not.toHaveBeenCalled();

    const ok = await reverse({ reason: " Error " });
    expect(ok.status).toBe(200);
    expect(reversePayment).toHaveBeenCalledWith(
      { db: "pool" },
      { userId: "u" },
      { idempotencyKey: KEY, paymentId: PAYMENT, reason: "Error" },
    );
  });
});
