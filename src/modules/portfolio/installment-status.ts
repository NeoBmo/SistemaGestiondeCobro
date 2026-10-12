import { daysBetween, type IsoDate } from "@/shared/dates/dates";

/**
 * Estado de una cuota (02 §2.4). Es **derivado** al leer: ni se guarda ni lo cambia un proceso
 * programado. `today` es la fecha de hoy en la zona horaria del negocio. Con pagos (F4) el saldo
 * pendiente decide `PAGADA` y `PARCIAL`; en F3 todavía no hay pagos, así que toda cuota tiene su
 * valor completo pendiente.
 */
export type InstallmentStatus = "PENDIENTE" | "VENCIDA" | "PAGADA";

export function deriveInstallmentStatus(
  installment: { dueOn: IsoDate; pendingAmount: number },
  today: IsoDate,
): InstallmentStatus {
  if (installment.pendingAmount <= 0) return "PAGADA";
  // Una cuota que vence hoy todavía no está vencida: tiene 0 días de mora (02 §2.4 y §3.3).
  return daysBetween(installment.dueOn, today) > 0 ? "VENCIDA" : "PENDIENTE";
}

/** Días de mora de una cuota con saldo: `máximo(0, hoy − vencimiento)` (02 §3.3). */
export function daysLate(dueOn: IsoDate, today: IsoDate): number {
  return Math.max(0, daysBetween(dueOn, today));
}
