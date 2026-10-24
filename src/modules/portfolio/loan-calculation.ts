import { addDays, addMonthsClamped, isoDate, type IsoDate } from "@/shared/dates/dates";
import { AppError } from "@/shared/errors/app-error";
import { computeInterest, formatMoney, money, type Money } from "@/shared/money/money";

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

function assertTerms(terms: LoanTerms): IsoDate {
  // Un `IsoDate` mal formado o inexistente (30 de febrero) no se normaliza en silencio a otro día.
  const firstDueOn = isoDate(terms.firstDueOn);
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
  return firstDueOn;
}

/**
 * Reparte `amount` en `count` cuotas (ADR 0007): las cuotas 1..n−1 valen piso(amount / n) y la última
 * absorbe el resto, así la suma es exactamente `amount`.
 */
function splitEvenly(amount: Money, count: number): Money[] {
  if (amount < count) {
    throw invalid("INSTALLMENTS_EXCEED_TOTAL", "Hay más cuotas que pesos por pagar");
  }
  const regular = Math.floor(amount / count);
  return Array.from({ length: count }, (_, index) =>
    money(index === count - 1 ? amount - regular * (count - 1) : regular),
  );
}

/** Numera las cuotas 1..n; las fechas salen de la primera, en calendario corrido. */
function buildSchedule(
  amounts: Money[],
  frequency: LoanFrequency,
  firstDueOn: IsoDate,
): PlannedInstallment[] {
  return amounts.map((amount, index) => ({
    number: index + 1,
    dueOn: dueDate(firstDueOn, frequency, index),
    amount,
  }));
}

/**
 * Montos escritos por el Admin para las cuotas que faltan (02 §6.1): uno por cuota, cada uno entero y
 * mayor que cero, y la suma exactamente el saldo pendiente (la base exige lo mismo al confirmar).
 */
function assertInstallmentAmounts(
  amounts: readonly number[],
  count: number,
  pendingBalance: Money,
): Money[] {
  if (amounts.length !== count) {
    throw invalid(
      "INSTALLMENT_AMOUNTS_COUNT_MISMATCH",
      `Hay ${count} cuota(s) que faltan y se enviaron ${amounts.length} monto(s)`,
    );
  }
  let sum = 0;
  for (const [index, amount] of amounts.entries()) {
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw invalid(
        "INVALID_INSTALLMENT_AMOUNT",
        `El monto de la cuota ${index + 1} debe ser un entero mayor que cero`,
      );
    }
    // Se suma solo mientras no se pase del saldo: la suma nunca sale de los enteros seguros.
    if (sum <= pendingBalance) sum += amount;
  }
  if (sum !== pendingBalance) {
    const pending = formatMoney(pendingBalance);
    throw invalid(
      "INSTALLMENT_AMOUNTS_SUM_MISMATCH",
      sum > pendingBalance
        ? `Las cuotas suman más que el saldo pendiente (${pending}): deben sumar exactamente el saldo`
        : `Las cuotas suman ${formatMoney(money(sum))} y el saldo pendiente es ${pending}: deben sumar exactamente el saldo`,
    );
  }
  return amounts.map((amount) => money(amount));
}

export function calculateLoan(terms: LoanTerms): LoanPlan {
  const firstDueOn = assertTerms(terms);
  const principal = money(terms.principal);
  const interest = computeInterest(principal, terms.interestBps);
  const total = money(principal + interest);
  return {
    principal,
    interest,
    total,
    installments: buildSchedule(
      splitEvenly(total, terms.installmentCount),
      terms.frequency,
      firstDueOn,
    ),
  };
}

export type ImportedLoanTerms = LoanTerms & {
  /** Saldo que aún se debe al importar (02 §6.1): es lo que suman las cuotas que faltan. */
  pendingBalance: number;
  /** Monto de cada cuota que falta, escrito por el Admin. Sin él, el saldo se reparte en partes iguales. */
  installmentAmounts?: readonly number[];
};

export type ImportedLoanPlan = LoanPlan & {
  /** Suma de las cuotas que faltan: el saldo inicial pendiente. */
  scheduled: Money;
  /** `true` si los montos de las cuotas no son el reparto en partes iguales (el Admin los cambió). */
  customAmounts: boolean;
};

/**
 * Préstamo importado (02 §6.1, ADR 0007): el interés y el total se calculan como en uno nuevo (principal
 * original y porcentaje pactado), pero el calendario guarda **solo las cuotas que faltan** desde la próxima
 * fecha de cobro: el saldo pendiente repartido en partes iguales, o los montos que escribió el Admin si
 * suman exactamente ese saldo. Lo ya pagado queda como dato de referencia y no genera cuotas ni pagos.
 */
export function calculateImportedLoan(terms: ImportedLoanTerms): ImportedLoanPlan {
  const nextDueOn = assertTerms(terms);
  const principal = money(terms.principal);
  const interest = computeInterest(principal, terms.interestBps);
  const total = money(principal + interest);

  if (!Number.isSafeInteger(terms.pendingBalance) || terms.pendingBalance <= 0) {
    throw invalid(
      "INVALID_PENDING_BALANCE",
      "El saldo pendiente debe ser un entero mayor que cero",
    );
  }
  if (terms.pendingBalance > total) {
    throw invalid(
      "PENDING_EXCEEDS_TOTAL",
      "El saldo pendiente no puede ser mayor que el total pactado del préstamo",
    );
  }
  const scheduled = money(terms.pendingBalance);
  const even = splitEvenly(scheduled, terms.installmentCount);
  const amounts =
    terms.installmentAmounts === undefined
      ? even
      : assertInstallmentAmounts(terms.installmentAmounts, terms.installmentCount, scheduled);
  return {
    principal,
    interest,
    total,
    scheduled,
    customAmounts: amounts.some((amount, index) => amount !== even[index]),
    installments: buildSchedule(amounts, terms.frequency, nextDueOn),
  };
}

/**
 * Descuadre histórico (02 §6.1): total pactado − pagado histórico − saldo pendiente. `null` si no se
 * conoce lo pagado: sin ese dato no hay nada que cuadrar.
 */
export function historicalDifference(
  plan: Pick<ImportedLoanPlan, "total" | "scheduled">,
  historicalPaid: number | undefined,
): Money | null {
  return historicalPaid === undefined
    ? null
    : money(plan.total - money(historicalPaid) - plan.scheduled);
}

export type MismatchAcknowledgement = { confirmMismatch?: boolean; mismatchNote?: string };

/**
 * Si los datos históricos no cuadran, la importación exige confirmación explícita y una observación
 * (02 §6.1). Devuelve la observación que va a la auditoría, o `null` si los datos cuadran.
 */
export function assertMismatchAcknowledged(
  difference: Money | null,
  acknowledgement: MismatchAcknowledgement,
): string | null {
  if (difference === null || difference === 0) return null;
  if (acknowledgement.confirmMismatch !== true) {
    throw new AppError(
      "IMPORT_MISMATCH_UNCONFIRMED",
      `Los datos históricos no cuadran (diferencia de ${formatMoney(difference)}): confirma que quieres importar así y escribe una observación`,
      409,
    );
  }
  const note = acknowledgement.mismatchNote?.trim() ?? "";
  if (note === "") {
    throw invalid(
      "IMPORT_MISMATCH_NOTE_REQUIRED",
      "Escribe una observación que explique por qué los datos históricos no cuadran",
    );
  }
  return note;
}
