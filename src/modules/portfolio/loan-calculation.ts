import { addDays, addMonthsClamped, type IsoDate } from "@/shared/dates/dates";
import { AppError } from "@/shared/errors/app-error";
import { computeInterest, money, type Money } from "@/shared/money/money";

/**
 * Cálculo del préstamo y de su calendario de cuotas (02-DOMINIO §2.3–2.4, ADR 0007). Es una función
 * pura: no lee ni escribe la base de datos, así la vista previa y la confirmación calculan exactamente
 * lo mismo. El calendario se calcula una sola vez, al confirmar, y se guarda cuota por cuota.
 */

export const LOAN_FREQUENCIES = ["DIARIA", "SEMANAL", "MENSUAL"] as const;
export type LoanFrequency = (typeof LOAN_FREQUENCIES)[number];

/**
 * Topes técnicos (no reglas de negocio): mantienen principal, interés, total y sumas de cuotas dentro de
 * los enteros seguros de JS (regla 8) y evitan calendarios absurdos que bloqueen la transacción.
 */
export const MAX_PRINCIPAL = 1_000_000_000_000;
export const MAX_INTEREST_BPS = 1_000_000;
export const MAX_INSTALLMENTS = 1_000;

export type LoanTerms = {
  principal: number;
  /** Puntos básicos enteros: 20 % = 2000. */
  interestBps: number;
  frequency: LoanFrequency;
  installmentCount: number;
  /** Fecha de vencimiento de la cuota 1; las demás se derivan de ella. */
  firstDueOn: IsoDate;
};

export type PlannedInstallment = {
  /** 1..n, orden cronológico. */
  number: number;
  dueOn: IsoDate;
  amount: Money;
};

export type LoanPlan = {
  principal: Money;
  interest: Money;
  total: Money;
  installments: PlannedInstallment[];
};

const invalid = (code: string, message: string) => new AppError(code, message, 400);

function dueDate(first: IsoDate, frequency: LoanFrequency, index: number): IsoDate {
  switch (frequency) {
    case "DIARIA":
      return addDays(first, index);
    case "SEMANAL":
      return addDays(first, 7 * index);
    // Siempre desde la primera fecha: el ajuste de fin de mes no se acumula (31 ene → 28 feb → 31 mar).
    case "MENSUAL":
      return addMonthsClamped(first, index);
  }
}

export function calculateLoan(terms: LoanTerms): LoanPlan {
  if (!Number.isSafeInteger(terms.principal) || terms.principal <= 0) {
    throw invalid("INVALID_PRINCIPAL", "El monto prestado debe ser un entero mayor que cero");
  }
  if (terms.principal > MAX_PRINCIPAL) {
    throw invalid("INVALID_PRINCIPAL", "El monto prestado es demasiado grande");
  }
  if (!Number.isSafeInteger(terms.interestBps) || terms.interestBps < 0) {
    throw invalid(
      "INVALID_INTEREST_RATE",
      "El interés debe ser un entero no negativo en puntos básicos",
    );
  }
  if (terms.interestBps > MAX_INTEREST_BPS) {
    throw invalid("INVALID_INTEREST_RATE", "El interés es demasiado alto");
  }
  if (!LOAN_FREQUENCIES.includes(terms.frequency)) {
    throw invalid("INVALID_FREQUENCY", "La frecuencia de cobro no es válida");
  }
  const count = terms.installmentCount;
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_INSTALLMENTS) {
    throw invalid(
      "INVALID_INSTALLMENT_COUNT",
      `La cantidad de cuotas debe estar entre 1 y ${MAX_INSTALLMENTS}`,
    );
  }

  const principal = money(terms.principal);
  const interest = computeInterest(principal, terms.interestBps);
  const total = money(principal + interest);
  if (total < count) {
    throw invalid("INSTALLMENTS_EXCEED_TOTAL", "Hay más cuotas que pesos por pagar");
  }

  // Cuotas 1..n−1 = piso(total / n); la última absorbe el resto, así la suma es exactamente el total.
  const regular = Math.floor(total / count);
  const installments: PlannedInstallment[] = Array.from({ length: count }, (_, index) => {
    const isLast = index === count - 1;
    return {
      number: index + 1,
      dueOn: dueDate(terms.firstDueOn, terms.frequency, index),
      amount: money(isLast ? total - regular * (count - 1) : regular),
    };
  });

  return { principal, interest, total, installments };
}
