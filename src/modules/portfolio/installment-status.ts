import { daysBetween, type IsoDate } from "@/shared/dates/dates";

/**
 * Estado de una cuota (02 §2.4). Es **derivado** al leer: ni se guarda ni lo cambia un proceso
 * programado. `today` es la fecha de hoy en la zona horaria del negocio. Con pagos (F4) el saldo
 * pendiente decide `PAGADA` y `PARCIAL`; en F3 todavía no hay pagos, así que toda cuota tiene su
 * valor completo pendiente.
 */
export type InstallmentStatus = "PENDIENTE" | "PARCIAL" | "VENCIDA" | "PAGADA";

export function deriveInstallmentStatus(
  installment: { dueOn: IsoDate; pendingAmount: number; appliedAmount?: number },
  today: IsoDate,
): InstallmentStatus {
  if (installment.pendingAmount <= 0) return "PAGADA";
  // Una cuota que vence hoy todavía no está vencida: tiene 0 días de mora (02 §2.4 y §3.3).
  if (daysBetween(installment.dueOn, today) > 0) return "VENCIDA";
  // Con pago recibido y saldo, antes del vencimiento: parcial. Una vencida con pago parcial sigue
  // siendo VENCIDA (no hay un quinto estado): la UI añade «pago parcial» con `appliedAmount`.
  return (installment.appliedAmount ?? 0) > 0 ? "PARCIAL" : "PENDIENTE";
}

/** Días de mora de una cuota con saldo: `máximo(0, hoy − vencimiento)` (02 §3.3). */
export function daysLate(dueOn: IsoDate, today: IsoDate): number {
  return Math.max(0, daysBetween(dueOn, today));
}
