import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/shared/errors/app-error";

// Orden y mapeo HTTP de la ruta de anulación; el flujo real se cubre en integración (annul-contract*.test.ts).

const requireSession = vi.fn();
const authorizeBusinessAdmin = vi.fn();
const annulContract = vi.fn();

vi.mock("@/modules/identity/require-session", () => ({ requireSession }));
vi.mock("@/modules/identity/authorize-business-admin", () => ({ authorizeBusinessAdmin }));
vi.mock("@/modules/portfolio/contracts", () => ({ annulContract }));
vi.mock("@/shared/database/pg-pool", () => ({ getPool: () => "pool" }));

const KEY = "0b6f6e1c-6c51-4e9a-8d2b-3f1a2b3c4d5e";
const LOAN = "4f9d2d7e-1c34-4a55-9b0e-8c2d1e7f6a10";

async function post(
  body: unknown,
  options: { loanId?: string; headers?: Record<string, string> } = {},
) {
  const { POST } = await import("./route");
  return POST(
    new Request("https://app.cuadre.test/api/negocio/prestamos/x/anular", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "sec-fetch-site": "same-origin",
        "idempotency-key": KEY,
        ...options.headers,
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ loanId: options.loanId ?? LOAN }) },
  );
}

afterEach(() => {
  vi.resetAllMocks();
});

describe("POST /api/negocio/prestamos/[loanId]/anular", () => {
  it("autoriza antes de validar: un cobrador recibe 403 aunque el id, la clave y el motivo sean inválidos", async () => {
    requireSession.mockResolvedValue({ userId: "u" });
    authorizeBusinessAdmin.mockRejectedValue(
      new AppError("FORBIDDEN", "No tienes permiso para esta operación", 403),
    );

    const res = await post({}, { loanId: "no-uuid", headers: { "idempotency-key": "mala" } });

    expect(res.status).toBe(403);
    expect(annulContract).not.toHaveBeenCalled();
  });

  it("un id que no es UUID es 404; sin clave o sin motivo (o demasiado largo) es 400", async () => {
    requireSession.mockResolvedValue({ userId: "u" });
    authorizeBusinessAdmin.mockResolvedValue("b-1");

    expect((await post({ reason: "x" }, { loanId: "no-uuid" })).status).toBe(404);
    expect((await post({ reason: "x" }, { headers: { "idempotency-key": "mala" } })).status).toBe(
      400,
    );
    expect((await post({ reason: "   " })).status).toBe(400);
    expect((await post({ reason: "x".repeat(501) })).status).toBe(400);
    expect(annulContract).not.toHaveBeenCalled();
  });

  it("con todo válido anula y responde 200 con la bandera replayed; el 409 de un contrato ya anulado se propaga", async () => {
    requireSession.mockResolvedValue({ userId: "u" });
    authorizeBusinessAdmin.mockResolvedValue("b-1");
    annulContract.mockResolvedValueOnce({ result: { loanId: LOAN, balance: 5 }, replayed: false });

    const ok = await post({ reason: " Error de captura ", businessId: "otro" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({
      ok: true,
      data: { loanId: LOAN, balance: 5, replayed: false },
    });
    expect(annulContract).toHaveBeenCalledWith(
      { db: "pool" },
      { userId: "u" },
      { idempotencyKey: KEY, loanId: LOAN, reason: "Error de captura" },
    );

    annulContract.mockRejectedValueOnce(
      new AppError("CONTRACT_ALREADY_VOIDED", "Este contrato ya está anulado", 409),
    );
    const conflict = await post({ reason: "x" });
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error.code).toBe("CONTRACT_ALREADY_VOIDED");
  });
});
