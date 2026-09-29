import { addDays, addMonthsClamped, type IsoDate } from "@/shared/dates/dates";

/** Planes V1 (02-DOMINIO §1.1); coinciden con los códigos de `public.plans`. */
export const PLAN_CODES = ["SEMANAL", "MENSUAL", "ANUAL"] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

export function isPlanCode(value: unknown): value is PlanCode {
  return typeof value === "string" && (PLAN_CODES as readonly string[]).includes(value);
}

/**
 * Vencimiento de la suscripción (02-DOMINIO §1.3): semanal +7 días; mensual y anual mantienen el día
 * del mes, ajustado al último del mes si ese día no existe.
 */
export function subscriptionExpiry(plan: PlanCode, startsOn: IsoDate): IsoDate {
  switch (plan) {
    case "SEMANAL":
      return addDays(startsOn, 7);
    case "MENSUAL":
      return addMonthsClamped(startsOn, 1);
    case "ANUAL":
      return addMonthsClamped(startsOn, 12);
  }
}
