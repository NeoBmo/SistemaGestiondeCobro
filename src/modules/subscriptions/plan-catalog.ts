import { money, subtractMoney, type Money } from "@/shared/money/money";
import type { PlanCode } from "./plans";

/**
 * Lo que la landing muestra de cada plan (02-DOMINIO §1.1). Es contenido comercial estático y no
 * consulta la BD, para que la página pública funcione sin ella. Una prueba de integración comprueba que
 * precios, `maxActiveCollectors` y `dashboardConfigurable` coinciden con la tabla `plans`.
 */
export type PlanCatalogEntry = {
  code: PlanCode;
  name: string;
  validity: string;
  /** «por semana», «por mes», «por año». */
  pricePeriod: string;
  priceAmount: Money;
  /** Precio sin descuento (anual: 12 mensualidades); `null` si el plan no tiene descuento. */
  referencePriceAmount: Money | null;
  /** El anual es el plan objetivo y se presenta como la opción recomendada (02 §1.1). */
  recommended: boolean;
  maxActiveCollectors: number | null;
  dashboardConfigurable: boolean;
};

const MONTHLY_PRICE = money(100_000);

export const PLAN_CATALOG: readonly PlanCatalogEntry[] = [
  {
    code: "SEMANAL",
    name: "Semanal",
    validity: "7 días",
    pricePeriod: "por semana",
    priceAmount: money(25_000),
    referencePriceAmount: null,
    recommended: false,
    maxActiveCollectors: 5,
    dashboardConfigurable: false,
  },
  {
    code: "MENSUAL",
    name: "Mensual",
    validity: "1 mes",
    pricePeriod: "por mes",
    priceAmount: MONTHLY_PRICE,
    referencePriceAmount: null,
    recommended: false,
    maxActiveCollectors: null,
    dashboardConfigurable: true,
  },
  {
    code: "ANUAL",
    name: "Anual",
    validity: "1 año",
    pricePeriod: "por año",
    priceAmount: money(960_000),
    referencePriceAmount: money(MONTHLY_PRICE * 12),
    recommended: true,
    maxActiveCollectors: null,
    dashboardConfigurable: true,
  },
];

/** Descuento entero frente al precio de referencia (1.200.000 → 960.000 = 20). */
export function discountPercent(price: Money, reference: Money): number {
  return Math.round((subtractMoney(reference, price) * 100) / reference);
}

/** «Hasta 5 cobradores activos» o «Cobradores sin límite práctico». */
export function collectorsLabel(max: number | null): string {
  return max === null ? "Cobradores sin límite práctico" : `Hasta ${max} cobradores activos`;
}

export function dashboardLabel(configurable: boolean): string {
  return configurable ? "Dashboard configurable" : "Dashboard predeterminado";
}
