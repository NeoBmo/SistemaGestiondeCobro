/**
 * Explica cómo se aplicaría un pago de cuotas (02 §3.2): se cubre la cuota pendiente más antigua hasta su
 * saldo y el excedente pasa a la siguiente, en orden cronológico; el faltante se queda en su cuota. Es solo
 * una ayuda de lectura para el formulario: la aplicación real la decide el servidor dentro de la transacción.
 */
export type ExplainableInstallment = { number: number; pendingAmount: number };

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
  const open = installments
    .filter((installment) => installment.pendingAmount > 0)
    .sort((a, b) => a.number - b.number);
  const pending = open.reduce((sum, installment) => sum + installment.pendingAmount, 0);
  if (amount > pending) return { ok: false, reason: "EXCEEDS_BALANCE", pending };

  const lines: { installmentNumber: number; applied: number; pendingAfter: number }[] = [];
  let left = amount;
  for (const installment of open) {
    if (left === 0) break;
    const applied = Math.min(left, installment.pendingAmount);
    lines.push({
      installmentNumber: installment.number,
      applied,
      pendingAfter: installment.pendingAmount - applied,
    });
    left -= applied;
  }
  return { ok: true, lines, loanPendingAfter: pending - amount };
}
