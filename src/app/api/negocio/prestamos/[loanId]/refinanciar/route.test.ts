import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/shared/errors/app-error";

// Orden y mapeo HTTP de las rutas de refinanciación; el flujo real se cubre en integración (refinancing.test.ts).

const requireSession = vi.fn();
const authorizeBusinessAdmin = vi.fn();
const refinanceLoan = vi.fn();
const previewRefinancing = vi.fn();

vi.mock("@/modules/identity/require-session", () => ({ requireSession }));
vi.mock("@/modules/identity/authorize-business-admin", () => ({ authorizeBusinessAdmin }));
vi.mock("@/modules/portfolio/refinancing", () => ({ refinanceLoan, previewRefinancing }));
vi.mock("@/shared/database/pg-pool", () => ({ getPool: () => "pool" }));

const KEY = "0b6f6e1c-6c51-4e9a-8d2b-3f1a2b3c4d5e";
const LOAN = "4f9d2d7e-1c34-4a55-9b0e-8c2d1e7f6a10";
const valid = {
  additionalAmount: 0,
  interestBps: 2000,
  frequency: "SEMANAL",
  installmentCount: 4,
  firstDueOn: "2026-10-20",
};

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://app.cuadre.test/api/negocio/prestamos/x/refinanciar", {
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

describe("POST /api/negocio/prestamos/[loanId]/refinanciar", () => {
  async function post(body: unknown, loanId = LOAN, headers: Record<string, string> = {}) {
    const { POST } = await import("./route");
    return POST(request(body, headers), { params: Promise.resolve({ loanId }) });
  }

  it("autoriza antes de validar el id, la clave y el cuerpo", async () => {
    requireSession.mockResolvedValue({ userId: "u" });
    authorizeBusinessAdmin.mockRejectedValue(new AppError("FORBIDDEN", "No tienes permiso", 403));

    expect((await post({}, "no-uuid", { "idempotency-key": "mala" })).status).toBe(403);
    expect(refinanceLoan).not.toHaveBeenCalled();
  });

  it("id inválido es 404; condiciones inválidas son 400; válidas crean (201) y reenvío es 200", async () => {
    requireSession.mockResolvedValue({ userId: "u" });
    authorizeBusinessAdmin.mockResolvedValue("b-1");
    refinanceLoan.mockResolvedValueOnce({ result: { newLoanId: "n-1" }, replayed: false });
    refinanceLoan.mockResolvedValueOnce({ result: { newLoanId: "n-1" }, replayed: true });

    expect((await post(valid, "no-uuid")).status).toBe(404);
    for (const body of [
      { ...valid, additionalAmount: -1 },
      { ...valid, installmentCount: 0 },
      { ...valid, frequency: "QUINCENAL" },
      { ...valid, interestBps: 1.5 },
      { ...valid, firstDueOn: "2026-02-30" },
    ]) {
      expect((await post(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await post(valid, LOAN, { "idempotency-key": "mala" })).status).toBe(400);
    expect(refinanceLoan).not.toHaveBeenCalled();

    expect((await post({ ...valid, principal: 1, businessId: "otro" })).status).toBe(201);
    expect((await post(valid)).status).toBe(200);
    expect(refinanceLoan).toHaveBeenCalledWith(
      { db: "pool" },
      { userId: "u" },
      expect.not.objectContaining({ principal: expect.anything(), businessId: expect.anything() }),
    );
  });
});

describe("POST /api/negocio/prestamos/[loanId]/refinanciar/vista-previa", () => {
  it("autoriza primero, valida las condiciones y calcula sin clave de idempotencia", async () => {
    const { POST } = await import("./vista-previa/route");
    const call = (body: unknown) =>
      POST(request(body), { params: Promise.resolve({ loanId: LOAN }) });

    requireSession.mockResolvedValue({ userId: "u" });
    authorizeBusinessAdmin.mockRejectedValueOnce(
      new AppError("FORBIDDEN", "No tienes permiso", 403),
    );
    expect((await call({})).status).toBe(403);

    authorizeBusinessAdmin.mockResolvedValue("b-1");
    previewRefinancing.mockResolvedValue({ refinancedBalance: 150_000 });
    expect((await call({ ...valid, installmentCount: 0 })).status).toBe(400);
    const ok = await call(valid);
    expect(ok.status).toBe(200);
    expect((await ok.json()).data.refinancedBalance).toBe(150_000);
  });
});
