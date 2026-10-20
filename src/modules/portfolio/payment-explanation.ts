import { allocatePayment, type ExplainableInstallment } from "./payment-allocation";

export type { ExplainableInstallment } from "./payment-allocation";

export type PaymentExplanation =
  | {
      ok: true;
      lines: { installmentNumber: number; applied: number; pendingAfter: number }[];
      loanPendingAfter: number;
    }
  | { ok: false; reason: "EXCEEDS_BALANCE"; pending: number };

export function explainPayment(
  installments: readonly ExplainableInstallment[],
  amount: number,
): PaymentExplanation {
  const allocation = allocatePayment(installments, amount);
  if (!allocation.ok) return allocation;
  return {
    ok: true,
    lines: allocation.lines.map(({ installment, applied, pendingAfter }) => ({
      installmentNumber: installment.number,
      applied,
      pendingAfter,
    })),
    loanPendingAfter: allocation.loanPendingAfter,
  };
}
