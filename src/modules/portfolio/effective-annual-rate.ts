import { daysBetween, type IsoDate } from "@/shared/dates/dates";

/**
 * Tasa efectiva anual (TEA) equivalente de un préstamo, para compararla con la tasa de usura (02 §2.3).
 *
 * Método (convención XIRR, año de 365 días): es la tasa interna de retorno de los flujos reales del
 * préstamo —el desembolso como salida el día 0 y cada cuota como entrada el día de su vencimiento, en días
 * calendario— expresada como efectiva anual. Se busca la tasa diaria `d` que anula el valor presente
 *
 *   VP(d) = Σ cuotaₖ / (1 + d)^tₖ − principal = 0,   tₖ = días del desembolso al vencimiento de la cuota k
 *
 * y se anualiza: TEA = (1 + d)^365 − 1. El número de cuotas y la frecuencia entran por el calendario, así un
 * mes de 28 o de 31 días pesa lo que dura de verdad. Como todas las cuotas son positivas, VP decrece con `d`
 * y la raíz es única: se encuentra por bisección con un número fijo de pasos (sin tolerancias que ajustar).
 *
 * Los importes son enteros (`Money`); los flotantes solo aparecen en la tasa. El resultado se redondea
 * half-up a puntos básicos enteros, la misma unidad en que se registra la usura.
 */

/**
 * Tope del cálculo: 10.000.000.000 % E.A. Un préstamo «gota a gota» típico (20 % en 12 cuotas diarias) da
 * unos 3.700.000 %; por encima del tope la potencia ya no cabe en un flotante, y para advertir basta con
 * saber que la tasa es al menos esa.
 */
export const MAX_EFFECTIVE_ANNUAL_RATE_BPS = 1_000_000_000_000;

const DAYS_PER_YEAR = 365;
const BISECTION_STEPS = 200;
/** Tasa diaria que corresponde al tope: el extremo superior de la bisección. */
const MAX_DAILY_RATE = Math.expm1(
  Math.log1p(MAX_EFFECTIVE_ANNUAL_RATE_BPS / 10_000) / DAYS_PER_YEAR,
);

export type RateFlows = {
  principal: number;
  disbursedOn: IsoDate;
  installments: readonly { dueOn: IsoDate; amount: number }[];
};

export type EffectiveAnnualRate = {
  /** Puntos básicos enteros: 28,59 % = 2859. */
  bps: number;
  /** `true` si la tasa alcanzó el tope: es **al menos** `bps`. */
  capped: boolean;
};

function assertFlows(flows: RateFlows): { days: number; amount: number }[] {
  if (!Number.isSafeInteger(flows.principal) || flows.principal <= 0) {
    throw new Error("TEA: el principal debe ser un entero positivo");
  }
  if (flows.installments.length === 0) throw new Error("TEA: el préstamo no tiene cuotas");
  let total = 0;
  const points = flows.installments.map(({ dueOn, amount }) => {
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new Error("TEA: cada cuota debe ser un entero positivo");
    }
    const days = daysBetween(flows.disbursedOn, dueOn);
    if (days < 0) throw new Error("TEA: una cuota vence antes del desembolso");
    total += amount;
    return { days, amount };
  });
  // El interés no es negativo (02 §2.3): la tasa tampoco.
  if (total < flows.principal) throw new Error("TEA: las cuotas suman menos que el principal");
  return points;
}

export function effectiveAnnualRate(flows: RateFlows): EffectiveAnnualRate {
  const points = assertFlows(flows);
  const presentValue = (daily: number) =>
    points.reduce((sum, { days, amount }) => sum + amount / Math.pow(1 + daily, days), 0) -
    flows.principal;

  // VP(0) = total − principal ≥ 0. Si sigue positivo en el tope (p. ej. interés cobrado el mismo día del
  // desembolso), la tasa es al menos el tope.
  if (presentValue(MAX_DAILY_RATE) > 0) {
    return { bps: MAX_EFFECTIVE_ANNUAL_RATE_BPS, capped: true };
  }
  let low = 0;
  let high = MAX_DAILY_RATE;
  // 200 mitades llevan el intervalo por debajo de la precisión del flotante: el resultado ya no cambia.
  for (let step = 0; step < BISECTION_STEPS; step += 1) {
    const middle = (low + high) / 2;
    if (presentValue(middle) > 0) low = middle;
    else high = middle;
  }
  const annual = Math.expm1(DAYS_PER_YEAR * Math.log1p((low + high) / 2));
  const bps = Math.min(Math.floor(annual * 10_000 + 0.5), MAX_EFFECTIVE_ANNUAL_RATE_BPS);
  return { bps, capped: bps === MAX_EFFECTIVE_ANNUAL_RATE_BPS };
}

/** `2859` → `28,59 %`; `368810110` → `3.688.101,10 %`. Aritmética entera, sin `Intl`. */
export function formatRateBps(bps: number): string {
  const whole = String(Math.floor(bps / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${whole},${String(bps % 100).padStart(2, "0")} %`;
}
