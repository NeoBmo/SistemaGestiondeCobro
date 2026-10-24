import { describe, expect, it } from "vitest";
import { allocatePayment } from "./payment-allocation";

describe("allocatePayment", () => {
  it("conserva el pago y respeta saldo, orden y remanente en calendarios variados", () => {
    for (const count of [1, 2, 3, 7, 12]) {
      const installments = Array.from({ length: count }, (_, index) => ({
        id: `installment-${index + 1}`,
        number: index + 1,
        pendingAmount: (index + count) % 4 === 0 ? 0 : ((index * 19 + count * 7) % 23) + 1,
      })).reverse();
      const open = installments
        .filter((installment) => installment.pendingAmount > 0)
        .toSorted((a, b) => a.number - b.number);
      const totalPending = open.reduce((sum, installment) => sum + installment.pendingAmount, 0);

      for (let amount = 1; amount <= totalPending; amount += 1) {
        const result = allocatePayment(installments, amount);
        expect(result.ok, `${count} cuotas, pago ${amount}`).toBe(true);
        if (!result.ok) continue;

        expect(result.lines.reduce((sum, line) => sum + line.applied, 0)).toBe(amount);
        expect(result.pending).toBe(totalPending);
        expect(result.loanPendingAfter).toBe(totalPending - amount);
        // 02 §3.2: cada cuota se salda antes de pasar a la siguiente; solo la última puede quedar parcial.
        for (const line of result.lines.slice(0, -1)) expect(line.pendingAfter).toBe(0);
        expect(result.lines.every((line) => line.applied > 0)).toBe(true);
        expect(
          result.lines.map((line) => line.installment.number),
          `${count} cuotas, pago ${amount}`,
        ).toEqual(open.slice(0, result.lines.length).map((installment) => installment.number));

        for (const line of result.lines) {
          expect(line.applied).toBeLessThanOrEqual(line.installment.pendingAmount);
          expect(line.pendingAfter).toBe(line.installment.pendingAmount - line.applied);
        }
      }

      expect(allocatePayment(installments, totalPending + 1)).toEqual({
        ok: false,
        reason: "EXCEEDS_BALANCE",
        pending: totalPending,
      });
    }
  });
});
