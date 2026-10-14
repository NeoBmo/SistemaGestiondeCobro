import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/shared/errors/app-error";

// Orden y mapeo HTTP de las rutas del cobrador y del fondo; el flujo real se cubre en integración (sessions.test.ts).

const requireSession = vi.fn();
const authorizeCollector = vi.fn();
const authorizeBusinessAdmin = vi.fn();
const openSession = vi.fn();
const registerCollectorExpense = vi.fn();
const transferFund = vi.fn();
const registerCollectorPayment = vi.fn();
const registerAttempt = vi.fn();

vi.mock("@/modules/identity/require-session", () => ({ requireSession }));
vi.mock("@/modules/identity/authorize-collector", () => ({ authorizeCollector }));
vi.mock("@/modules/identity/authorize-business-admin", () => ({ authorizeBusinessAdmin }));
vi.mock("@/modules/collections/sessions", () => ({
  openSession,
  registerCollectorExpense,
  transferFund,
}));
vi.mock("@/modules/collections/attempts", () => ({ registerAttempt }));
vi.mock("@/modules/portfolio/payments", () => ({ registerCollectorPayment }));
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

describe("rutas del cobrador", () => {
  it("autorizan antes de validar la clave y el cuerpo", async () => {
    requireSession.mockResolvedValue({ userId: "u" });
    authorizeCollector.mockRejectedValue(new AppError("FORBIDDEN", "No", 403));
    const modules = [
      await import("./jornada/route"),
      await import("./pagos/route"),
      await import("./gastos/route"),
      await import("./intentos/route"),
    ];
    for (const { POST } of modules) {
      expect((await POST(request({}, { "idempotency-key": "mala" }))).status).toBe(403);
    }
    expect(openSession).not.toHaveBeenCalled();
    expect(registerCollectorPayment).not.toHaveBeenCalled();
  });

  it("exigen clave y cuerpo válidos y crean (201) o repiten (200)", async () => {
    requireSession.mockResolvedValue({ userId: "u" });
    authorizeCollector.mockResolvedValue("b-1");
    registerCollectorExpense.mockResolvedValue({ result: { expenseId: "e" }, replayed: false });
    registerCollectorPayment.mockResolvedValue({ result: { paymentId: "p" }, replayed: true });
    registerAttempt.mockResolvedValue({ result: { attemptId: "a" }, replayed: false });
    openSession.mockResolvedValue({ result: { sessionId: "s" }, replayed: false });

    const { POST: expense } = await import("./gastos/route");
    expect(
      (
        await expense(
          request({ amount: 1000, category: "GASOLINA" }, { "idempotency-key": "mala" }),
        )
      ).status,
    ).toBe(400);
    expect((await expense(request({ amount: 1000, category: "OTRO" }))).status).toBe(400);
    expect((await expense(request({ amount: 1000, category: "GASOLINA" }))).status).toBe(201);

    const { POST: payment } = await import("./pagos/route");
    expect((await payment(request({ loanId: ID, amount: 0 }))).status).toBe(400);
    expect((await payment(request({ loanId: ID, amount: 100, businessId: "x" }))).status).toBe(200);

    const { POST: attempt } = await import("./intentos/route");
    expect((await attempt(request({ clientId: ID, type: "INTENTO_FALLIDO" }))).status).toBe(400);
    expect(
      (await attempt(request({ clientId: ID, type: "INTENTO_FALLIDO", reason: "OTRO" }))).status,
    ).toBe(400);
    expect(
      (await attempt(request({ clientId: ID, type: "INTENTO_FALLIDO", reason: "SIN_DINERO" })))
        .status,
    ).toBe(201);

    const { POST: session } = await import("./jornada/route");
    expect((await session(request({}))).status).toBe(201);
  });
});

describe("POST /api/negocio/jornadas/fondo", () => {
  it("autoriza antes de validar y exige jornada e importe entero positivo", async () => {
    requireSession.mockResolvedValue({ userId: "u" });
    const { POST } = await import("../negocio/jornadas/fondo/route");
    authorizeBusinessAdmin.mockRejectedValueOnce(new AppError("FORBIDDEN", "No", 403));
    expect((await POST(request({}, { "idempotency-key": "mala" }))).status).toBe(403);

    authorizeBusinessAdmin.mockResolvedValue("b-1");
    transferFund.mockResolvedValue({ result: {}, replayed: false });
    for (const body of [{}, { sessionId: ID, amount: 0 }, { sessionId: ID, amount: 1.5 }]) {
      expect((await POST(request(body))).status, JSON.stringify(body)).toBe(400);
    }
    expect((await POST(request({ sessionId: ID, amount: 5000 }))).status).toBe(201);
  });
});
