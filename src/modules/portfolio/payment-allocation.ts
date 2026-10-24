/** Asigna un pago a las cuotas pendientes en orden cronológico (02 §3.2). */
export type ExplainableInstallment = { number: number; pendingAmount: number };

export type PaymentAllocation<T extends ExplainableInstallment = ExplainableInstallment> =
  | {
      ok: true;
      lines: { installment: T; applied: number; pendingAfter: number }[];
      pending: number;
      loanPendingAfter: number;
    }
  | { ok: false; reason: "EXCEEDS_BALANCE"; pending: number };

export function allocatePayment<T extends ExplainableInstallment>(
  installments: readonly T[],
  amount: number,
): PaymentAllocation<T> {
  const open = installments
    .filter((installment) => installment.pendingAmount > 0)
    .sort((a, b) => a.number - b.number);
  const pending = open.reduce((sum, installment) => sum + installment.pendingAmount, 0);
  if (amount > pending) return { ok: false, reason: "EXCEEDS_BALANCE", pending };

  const lines: { installment: T; applied: number; pendingAfter: number }[] = [];
  let left = amount;
  for (const installment of open) {
    if (left === 0) break;
    const applied = Math.min(left, installment.pendingAmount);
    lines.push({ installment, applied, pendingAfter: installment.pendingAmount - applied });
    left -= applied;
  }
  return { ok: true, lines, pending, loanPendingAfter: pending - amount };
}
