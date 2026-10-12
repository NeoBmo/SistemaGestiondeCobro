import { describe, expect, it } from "vitest";
import { explainPayment } from "./payment-explanation";

const installments = [
  { number: 2, pendingAmount: 100 },
  { number: 1, pendingAmount: 40 }, // parcial: ya tenía un pago
  { number: 3, pendingAmount: 100 },
  { number: 0, pendingAmount: 0 }, // pagada
];

describe("explainPayment", () => {
  it("un pago parcial deja el faltante en su cuota", () => {
    expect(explainPayment(installments, 25)).toEqual({
      ok: true,
      lines: [{ installmentNumber: 1, applied: 25, pendingAfter: 15 }],
      loanPendingAfter: 215,
    });
  });

  it("el excedente pasa a la siguiente cuota en orden cronológico", () => {
    expect(explainPayment(installments, 150)).toEqual({
      ok: true,
      lines: [
        { installmentNumber: 1, applied: 40, pendingAfter: 0 },
        { installmentNumber: 2, applied: 100, pendingAfter: 0 },
        { installmentNumber: 3, applied: 10, pendingAfter: 90 },
      ],
      loanPendingAfter: 90,
    });
  });

  it("no hay saldo a favor: más que el pendiente no se aplica", () => {
    expect(explainPayment(installments, 241)).toEqual({
      ok: false,
      reason: "EXCEEDS_BALANCE",
      pending: 240,
    });
    expect(explainPayment(installments, 240)).toMatchObject({ ok: true, loanPendingAfter: 0 });
  });
});
