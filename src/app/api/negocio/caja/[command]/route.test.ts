import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/shared/errors/app-error";

// Cablea el Route Handler con dobles: los comandos reales se cubren en integración
// (cash-commands.test.ts). Aquí solo el orden y el mapeo HTTP.

const requireSession = vi.fn();
const authorizeCashActor = vi.fn();
const registerCapitalIncome = vi.fn();

vi.mock("@/modules/identity/require-session", () => ({ requireSession }));
vi.mock("@/modules/cash/run-cash-command", () => ({ authorizeCashActor }));
vi.mock("@/modules/cash/commands", () => ({
  registerCapitalIncome,
  registerOpeningBalance: vi.fn(),
  registerMainCashboxExpense: vi.fn(),
  registerAdjustment: vi.fn(),
  reverseMovement: vi.fn(),
}));
vi.mock("@/shared/database/pg-pool", () => ({ getPool: () => "pool" }));

const KEY = "0b6f6e1c-6c51-4e9a-8d2b-3f1a2b3c4d5e";

async function post(command: string, body: unknown, headers: Record<string, string> = {}) {
  const { POST } = await import("./route");
  return POST(
    new Request(`https://app.cuadre.test/api/negocio/caja/${command}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "sec-fetch-site": "same-origin",
        "idempotency-key": KEY,
        ...headers,
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ command }) },
  );
}

afterEach(() => {
  vi.resetAllMocks();
});

describe("POST /api/negocio/caja/[command]", () => {
  it("rechaza una petición cross-site antes de tocar la sesión", async () => {
    const res = await post("capital", { amount: 10 }, { "sec-fetch-site": "cross-site" });
    expect(res.status).toBe(403);
    expect(requireSession).not.toHaveBeenCalled();
  });

  it("un comando desconocido es 404 y no ejecuta nada", async () => {
    requireSession.mockResolvedValue({ userId: "u" });
    const res = await post("inventado", {});
    expect(res.status).toBe(404);
    expect(authorizeCashActor).not.toHaveBeenCalled();
  });

  it("autoriza antes de validar: un actor sin permiso recibe 403 aunque la clave y el cuerpo sean inválidos", async () => {
    requireSession.mockResolvedValue({ userId: "u" });
    authorizeCashActor.mockRejectedValue(
      new AppError("FORBIDDEN", "No tienes permiso para esta operación", 403),
    );

    const res = await post("capital", { amount: "no" }, { "idempotency-key": "mala" });

    expect(res.status).toBe(403);
    expect(registerCapitalIncome).not.toHaveBeenCalled();
  });

  it("exige una clave de idempotencia válida y un cuerpo válido (400)", async () => {
    requireSession.mockResolvedValue({ userId: "u" });
    authorizeCashActor.mockResolvedValue("b-1");

    expect((await post("capital", { amount: 10 }, { "idempotency-key": "mala" })).status).toBe(400);
    expect((await post("capital", { amount: -5 })).status).toBe(400);
    expect(registerCapitalIncome).not.toHaveBeenCalled();
  });

  it("un comando nuevo responde 201 y un reenvío 200, con la bandera replayed", async () => {
    const actor = { userId: "u" };
    requireSession.mockResolvedValue(actor);
    authorizeCashActor.mockResolvedValue("b-1");
    registerCapitalIncome.mockResolvedValueOnce({
      result: { movementId: "m-1", balance: 10 },
      replayed: false,
    });
    registerCapitalIncome.mockResolvedValueOnce({
      result: { movementId: "m-1", balance: 10 },
      replayed: true,
    });

    const created = await post("capital", { amount: 10, note: "x" });
    const again = await post("capital", { amount: 10, note: "x" });

    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({
      ok: true,
      data: { movementId: "m-1", balance: 10, replayed: false },
    });
    expect(again.status).toBe(200);
    expect(registerCapitalIncome).toHaveBeenCalledWith(
      { db: "pool" },
      actor,
      expect.objectContaining({ amount: 10, note: "x", idempotencyKey: KEY }),
    );
  });
  it("sin Idempotency-Key o con un Content-Type distinto de JSON no ejecuta (400/415)", async () => {
    requireSession.mockResolvedValue({ userId: "u" });
    authorizeCashActor.mockResolvedValue("b-1");
    const { POST } = await import("./route");
    const base = { method: "POST", body: JSON.stringify({ amount: 10 }) } as const;
    const url = "https://app.cuadre.test/api/negocio/caja/capital";
    const params = { params: Promise.resolve({ command: "capital" }) };

    const noKey = await POST(
      new Request(url, { ...base, headers: { "content-type": "application/json" } }),
      params,
    );
    const wrongType = await POST(
      new Request(url, {
        ...base,
        headers: { "content-type": "text/plain", "idempotency-key": KEY },
      }),
      params,
    );

    expect(noKey.status).toBe(400);
    expect(wrongType.status).toBe(415);
    expect(registerCapitalIncome).not.toHaveBeenCalled();
  });

  it("mapea el saldo insuficiente a 409 y descarta un business_id enviado en el cuerpo", async () => {
    requireSession.mockResolvedValue({ userId: "u" });
    authorizeCashActor.mockResolvedValue("b-1");
    registerCapitalIncome.mockRejectedValueOnce(
      new AppError("INSUFFICIENT_FUNDS", "La Caja Mayor no tiene saldo suficiente", 409),
    );

    const res = await post("capital", { amount: 10, businessId: "otro-negocio" });

    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("INSUFFICIENT_FUNDS");
    expect(registerCapitalIncome).toHaveBeenCalledWith(
      { db: "pool" },
      expect.anything(),
      expect.not.objectContaining({ businessId: expect.anything() }),
    );
  });
});
