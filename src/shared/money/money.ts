import { AppError } from "../errors/app-error";

/**
 * Importe en unidad mínima (V1: pesos colombianos, 1 = $1, sin decimales).
 * Entero seguro de JS; en PostgreSQL es `bigint`. Puede ser negativo (diferencias de caja):
 * la positividad se valida en cada comando, no aquí.
 */
declare const moneyBrand: unique symbol;
export type Money = number & { readonly [moneyBrand]: true };

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE = BigInt(Number.MIN_SAFE_INTEGER);
const BPS_DENOMINATOR = 10_000n;

function invalidMoney(): never {
  throw new AppError(
    "INVALID_MONEY",
    "Importe inválido: debe ser un entero dentro del rango seguro",
  );
}

function invalidRate(): never {
  throw new AppError(
    "INVALID_INTEREST_RATE",
    "Tasa de interés inválida: debe ser un entero no negativo de puntos básicos",
  );
}

/** Frontera de entrada: number, bigint o texto entero (así entrega `pg` los `bigint`). */
export function money(value: number | bigint | string): Money {
  if (typeof value === "bigint") {
    if (value > MAX_SAFE || value < MIN_SAFE) invalidMoney();
    return money(Number(value));
  }
  if (typeof value === "string") {
    if (!/^-?\d+$/.test(value)) invalidMoney();
    return money(BigInt(value));
  }
  if (!Number.isSafeInteger(value)) invalidMoney();
  return (value === 0 ? 0 : value) as Money;
}

export function addMoney(a: Money, b: Money): Money {
  return money(a + b);
}

export function subtractMoney(a: Money, b: Money): Money {
  return money(a - b);
}

/** `$1.000.000`; negativos como `-$50.000`. Agrupación manual: no depende de datos ICU. */
export function formatMoney(value: Money): string {
  const digits = String(Math.abs(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${value < 0 ? "-" : ""}$${digits}`;
}

const MONEY_INPUT = /^(-?)\s*\$?\s*(\d{1,3}(?:\.\d{3})+|\d+)$/;

/** Interpreta texto de formulario (`1000000`, `$1.000.000`). `null` si es inválido o trae decimales. */
export function parseMoneyInput(input: string): Money | null {
  const match = MONEY_INPUT.exec(input.trim());
  if (!match) return null;
  const [, sign = "", digits = ""] = match;
  try {
    return money(`${sign}${digits.replaceAll(".", "")}`);
  } catch (error) {
    if (error instanceof AppError) return null;
    throw error;
  }
}

/** Porcentaje → puntos básicos enteros (20 → 2000, 12,5 → 1250). Rechaza precisión menor a 0,01 %. */
export function interestBpsFromPercent(percent: number): number {
  if (!Number.isFinite(percent) || percent < 0) invalidRate();
  const bps = Math.round(percent * 100);
  if (Math.abs(percent * 100 - bps) > 1e-6) invalidRate();
  return bps;
}

/** interés = redondeo half-up(principal × bps / 10000), en aritmética entera (02-DOMINIO §2.4). */
export function computeInterest(principal: Money, interestBps: number): Money {
  if (principal < 0) {
    throw new AppError("INVALID_PRINCIPAL", "El monto principal no puede ser negativo");
  }
  if (!Number.isSafeInteger(interestBps) || interestBps < 0) invalidRate();
  const numerator = BigInt(principal) * BigInt(interestBps);
  const interest = (2n * numerator + BPS_DENOMINATOR) / (2n * BPS_DENOMINATOR);
  return money(interest);
}
