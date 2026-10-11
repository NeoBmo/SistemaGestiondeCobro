import { daysBetween, type IsoDate } from "@/shared/dates/dates";

/** Estados que se guardan en `subscriptions.status` (ADR 0003). */
export type StoredSubscriptionStatus = "ACTIVA" | "SUSPENDIDA" | "ARCHIVADA";

/** Estado que ve el usuario: añade los dos informativos, que se derivan de la fecha y nunca se guardan. */
export type SubscriptionStatus = StoredSubscriptionStatus | "PROXIMA_A_VENCER" | "VENCIDA";

/** Días de antelación con los que una suscripción ACTIVA pasa a «próxima a vencer» (02-DOMINIO §1.3). */
export const EXPIRY_WARNING_DAYS = 5;

/**
 * Deriva el estado informativo al leer (02-DOMINIO §1.3): una suscripción ACTIVA a 5 días o menos de su
 * vencimiento es PROXIMA_A_VENCER y una con vencimiento ya pasado es VENCIDA. El propio día de
 * vencimiento todavía no está vencida. `today` es la fecha de hoy en la zona horaria del negocio.
 * Estos estados no bloquean nada: la única compuerta de acceso es `businesses.access_status`.
 */
export function deriveSubscriptionStatus(
  subscription: { status: StoredSubscriptionStatus; expiresOn: IsoDate },
  today: IsoDate,
): SubscriptionStatus {
  if (subscription.status !== "ACTIVA") return subscription.status;

  const daysLeft = daysBetween(today, subscription.expiresOn);
  if (daysLeft < 0) return "VENCIDA";
  if (daysLeft <= EXPIRY_WARNING_DAYS) return "PROXIMA_A_VENCER";
  return "ACTIVA";
}
