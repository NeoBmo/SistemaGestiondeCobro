import type { PlanCode } from "@/modules/subscriptions/plans";
import { isPeriod, type Period } from "./periods";

/** Indicadores del dashboard (ADR 0010), en su orden predeterminado. */
export const WIDGETS = [
  "CASH_BALANCE",
  "PORTFOLIO_PENDING",
  "PORTFOLIO_OVERDUE",
  "COLLECTED",
  "SPENT",
  "SETTLEMENTS",
  "PROJECTION",
] as const;
export type Widget = (typeof WIDGETS)[number];

export const WIDGET_LABEL: Record<Widget, string> = {
  CASH_BALANCE: "Caja Mayor",
  PORTFOLIO_PENDING: "Cartera pendiente",
  PORTFOLIO_OVERDUE: "Cartera vencida",
  COLLECTED: "Cobrado del periodo",
  SPENT: "Gastos del periodo",
  SETTLEMENTS: "Jornadas y diferencias",
  PROJECTION: "Proyección de 7 días",
};

export function isWidget(value: unknown): value is Widget {
  return typeof value === "string" && (WIDGETS as readonly string[]).includes(value);
}

export type DashboardConfig = {
  period: Period;
  widgets: Widget[];
  /** Solo los planes mensual y anual pueden cambiarlo (ADR 0010). */
  configurable: boolean;
};

/**
 * Configuración efectiva: el plan semanal siempre ve la predeterminada (7 días y todos los indicadores);
 * mensual y anual ven la guardada o, si no hay, todos los indicadores y 30 días.
 */
export function resolveDashboardConfig(
  plan: PlanCode | null,
  saved: { period: string; widgets: unknown } | null,
): DashboardConfig {
  const configurable = plan === "MENSUAL" || plan === "ANUAL";
  if (!configurable) return { period: "7D", widgets: [...WIDGETS], configurable: false };
  if (!saved) return { period: "30D", widgets: [...WIDGETS], configurable: true };
  const widgets = Array.isArray(saved.widgets) ? saved.widgets.filter(isWidget) : [...WIDGETS];
  return {
    period: isPeriod(saved.period) ? saved.period : "30D",
    widgets,
    configurable: true,
  };
}
