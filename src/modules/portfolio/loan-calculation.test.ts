import { describe, expect, it } from "vitest";
import { isoDate } from "@/shared/dates/dates";
import { AppError } from "@/shared/errors/app-error";
import { money } from "@/shared/money/money";
import {
  MAX_INSTALLMENTS,
  MAX_INTEREST_BPS,
  MAX_PRINCIPAL,
  assertMismatchAcknowledged,
  calculateImportedLoan,
  calculateLoan,
  historicalDifference,
  type ImportedLoanTerms,
  type LoanTerms,
} from "./loan-calculation";

const terms = (overrides: Partial<LoanTerms> = {}): LoanTerms => ({
  principal: 1_000_000,
  interestBps: 2000,
  frequency: "DIARIA",
  installmentCount: 12,
  firstDueOn: isoDate("2026-10-13"),
  ...overrides,
});

const sum = (plan: ReturnType<typeof calculateLoan>) =>
  plan.installments.reduce((acc, installment) => acc + installment.amount, 0);

describe("cálculo del préstamo (02 §2.4)", () => {
  it("$1.000.000 al 20 % → interés $200.000, total $1.200.000; en 12 cuotas, $100.000 cada una", () => {
    const plan = calculateLoan(terms());

    expect(plan).toMatchObject({ principal: 1_000_000, interest: 200_000, total: 1_200_000 });
    expect(plan.installments).toHaveLength(12);
    expect(plan.installments.every((installment) => installment.amount === 100_000)).toBe(true);
    expect(sum(plan)).toBe(1_200_000);
  });

  it("el interés se redondea half-up una sola vez y admite medios puntos (12,5 % = 1250 bps)", () => {
    // 1.001 × 12,5 % = 125,125 → 125.
    expect(
      calculateLoan(terms({ principal: 1_001, interestBps: 1250, installmentCount: 1 })),
    ).toMatchObject({
      interest: 125,
      total: 1_126,
    });
    // 10 × 5 % = 0,5 → 1 (half-up).
    expect(
      calculateLoan(terms({ principal: 10, interestBps: 500, installmentCount: 1 })).interest,
    ).toBe(1);
    expect(calculateLoan(terms({ interestBps: 0 }))).toMatchObject({
      interest: 0,
      total: 1_000_000,
    });
  });

  it("cuando el total no se divide exacto, las cuotas 1..n−1 valen el piso y la última el resto", () => {
    const plan = calculateLoan(
      terms({ principal: 1_000_000, interestBps: 0, installmentCount: 3 }),
    );

    expect(plan.installments.map((installment) => installment.amount)).toEqual([
      333_333, 333_333, 333_334,
    ]);
    expect(sum(plan)).toBe(1_000_000);
  });

  it("la suma de cuotas es exactamente el total para muchas combinaciones", () => {
    for (const principal of [1, 7, 999, 1_000_001, 123_456_789]) {
      for (const interestBps of [0, 1, 1250, 2000, 3333]) {
        for (const installmentCount of [1, 2, 3, 6, 7, 12, 24, 100]) {
          // Con menos pesos que cuotas el cálculo se rechaza (probado aparte).
          if (principal < installmentCount) continue;
          const plan = calculateLoan(terms({ principal, interestBps, installmentCount }));
          expect(sum(plan), `${principal}/${interestBps}/${installmentCount}`).toBe(plan.total);
          const regular = plan.installments[0]!.amount;
          for (const installment of plan.installments.slice(0, -1)) {
            expect(installment.amount).toBe(regular);
          }
          expect(plan.installments.at(-1)!.amount).toBeGreaterThanOrEqual(regular);
        }
      }
    }
  });

  it("numera las cuotas en orden y con fechas estrictamente crecientes", () => {
    for (const frequency of ["DIARIA", "SEMANAL", "MENSUAL"] as const) {
      const { installments } = calculateLoan(terms({ frequency, installmentCount: 24 }));
      expect(installments.map((installment) => installment.number)).toEqual(
        Array.from({ length: 24 }, (_, i) => i + 1),
      );
      for (let i = 1; i < installments.length; i += 1) {
        expect(installments[i]!.dueOn > installments[i - 1]!.dueOn, frequency).toBe(true);
      }
    }
  });
  it("el piso se aplica aunque la fracción sea mayor que .5: 5 en 3 cuotas = [1, 1, 3]", () => {
    const plan = calculateLoan(terms({ principal: 5, interestBps: 0, installmentCount: 3 }));
    expect(plan.installments.map((installment) => installment.amount)).toEqual([1, 1, 3]);
    const wide = calculateLoan(terms({ principal: 1999, interestBps: 0, installmentCount: 1000 }));
    expect(wide.installments[0]!.amount).toBe(1);
    expect(wide.installments.at(-1)!.amount).toBe(1000);
  });

  it("con los topes máximos juntos no desborda y la suma sigue siendo exacta", () => {
    const plan = calculateLoan(
      terms({
        principal: MAX_PRINCIPAL,
        interestBps: MAX_INTEREST_BPS,
        installmentCount: MAX_INSTALLMENTS,
        frequency: "DIARIA",
      }),
    );
    expect(plan.interest).toBe(100_000_000_000_000);
    expect(Number.isSafeInteger(plan.total)).toBe(true);
    expect(sum(plan)).toBe(plan.total);
  });
});

describe("calendario corrido (ADR 0007)", () => {
  it("diaria: cada día calendario, incluidos los domingos", () => {
    const { installments } = calculateLoan(
      terms({ frequency: "DIARIA", installmentCount: 4, firstDueOn: isoDate("2026-10-16") }),
    );
    // 2026-10-17 es sábado y 2026-10-18 domingo: no se saltan.
    expect(installments.map((installment) => installment.dueOn)).toEqual([
      "2026-10-16",
      "2026-10-17",
      "2026-10-18",
      "2026-10-19",
    ]);
  });

  it("semanal: +7 días, también al cruzar de mes y de año", () => {
    const { installments } = calculateLoan(
      terms({ frequency: "SEMANAL", installmentCount: 4, firstDueOn: isoDate("2026-12-20") }),
    );
    expect(installments.map((installment) => installment.dueOn)).toEqual([
      "2026-12-20",
      "2026-12-27",
      "2027-01-03",
      "2027-01-10",
    ]);
  });

  it("mensual: el mismo día del mes con ajuste a fin de mes que no se acumula", () => {
    const { installments } = calculateLoan(
      terms({ frequency: "MENSUAL", installmentCount: 5, firstDueOn: isoDate("2027-01-31") }),
    );
    expect(installments.map((installment) => installment.dueOn)).toEqual([
      "2027-01-31",
      "2027-02-28",
      "2027-03-31",
      "2027-04-30",
      "2027-05-31",
    ]);
    // Año bisiesto.
    expect(
      calculateLoan(
        terms({ frequency: "MENSUAL", installmentCount: 2, firstDueOn: isoDate("2028-01-31") }),
      ).installments[1]!.dueOn,
    ).toBe("2028-02-29");
  });

  it("diaria cruza fin de mes y de año; mensual cruza diciembre y supera 12 cuotas", () => {
    const daily = calculateLoan(
      terms({ frequency: "DIARIA", installmentCount: 3, firstDueOn: isoDate("2026-12-30") }),
    );
    expect(daily.installments.map((installment) => installment.dueOn)).toEqual([
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
    ]);
    const monthly = calculateLoan(
      terms({ frequency: "MENSUAL", installmentCount: 14, firstDueOn: isoDate("2026-11-15") }),
    );
    expect(monthly.installments[1]!.dueOn).toBe("2026-12-15");
    expect(monthly.installments[2]!.dueOn).toBe("2027-01-15");
    expect(monthly.installments[13]!.dueOn).toBe("2027-12-15");
  });

  it("mensual con día 30 o 29 en febrero, año no bisiesto y partiendo de un 29 de febrero", () => {
    const from30 = calculateLoan(
      terms({ frequency: "MENSUAL", installmentCount: 3, firstDueOn: isoDate("2027-01-30") }),
    );
    expect(from30.installments.map((installment) => installment.dueOn)).toEqual([
      "2027-01-30",
      "2027-02-28",
      "2027-03-30",
    ]);
    const fromLeapDay = calculateLoan(
      terms({ frequency: "MENSUAL", installmentCount: 13, firstDueOn: isoDate("2028-02-29") }),
    );
    expect(fromLeapDay.installments[1]!.dueOn).toBe("2028-03-29");
    expect(fromLeapDay.installments[12]!.dueOn).toBe("2029-02-28");
  });
});

describe("validación de las condiciones", () => {
  const codeOf = (overrides: Partial<LoanTerms>) => {
    try {
      calculateLoan(terms(overrides));
    } catch (error) {
      return error instanceof AppError ? error.code : "otro";
    }
    return "sin error";
  };

  it("rechaza principal no positivo, decimal o fuera de tope", () => {
    for (const principal of [0, -1, 1.5, Number.NaN, MAX_PRINCIPAL + 1]) {
      expect(codeOf({ principal }), String(principal)).toBe("INVALID_PRINCIPAL");
    }
    expect(codeOf({ principal: MAX_PRINCIPAL })).toBe("sin error");
    expect(codeOf({ interestBps: MAX_INTEREST_BPS })).toBe("sin error");
  });

  it("rechaza interés negativo, decimal o fuera de tope", () => {
    for (const interestBps of [-1, 0.5, Number.NaN, MAX_INTEREST_BPS + 1]) {
      expect(codeOf({ interestBps }), String(interestBps)).toBe("INVALID_INTEREST_RATE");
    }
  });

  it("rechaza frecuencia desconocida y cantidades de cuotas inválidas", () => {
    expect(codeOf({ frequency: "QUINCENAL" as never })).toBe("INVALID_FREQUENCY");
    for (const installmentCount of [0, -3, 2.5, MAX_INSTALLMENTS + 1]) {
      expect(codeOf({ installmentCount }), String(installmentCount)).toBe(
        "INVALID_INSTALLMENT_COUNT",
      );
    }
    expect(codeOf({ installmentCount: MAX_INSTALLMENTS })).toBe("sin error");
  });

  it("una fecha de primera cuota inválida se rechaza con un AppError", () => {
    expect(() => calculateLoan(terms({ firstDueOn: "2026-02-30" as never }))).toThrow(AppError);
  });

  it("rechaza más cuotas que pesos por pagar (cuotas de cero)", () => {
    expect(codeOf({ principal: 5, interestBps: 0, installmentCount: 6 })).toBe(
      "INSTALLMENTS_EXCEED_TOTAL",
    );
    expect(codeOf({ principal: 6, interestBps: 0, installmentCount: 6 })).toBe("sin error");
  });
});

describe("préstamo importado (02 §6.1, ADR 0007)", () => {
  const imported = (overrides: Partial<ImportedLoanTerms> = {}): ImportedLoanTerms => ({
    ...terms(),
    pendingBalance: 600_000,
    installmentCount: 6,
    firstDueOn: isoDate("2026-10-20"),
    ...overrides,
  });

  it("calcula interés y total como un préstamo nuevo y guarda solo las cuotas que faltan, que suman el saldo", () => {
    const plan = calculateImportedLoan(imported());

    expect(plan).toMatchObject({
      principal: 1_000_000,
      interest: 200_000,
      total: 1_200_000,
      scheduled: 600_000,
    });
    expect(plan.installments).toHaveLength(6);
    expect(plan.installments.every((i) => i.amount === 100_000)).toBe(true);
    expect(plan.installments[0]).toEqual({ number: 1, dueOn: "2026-10-20", amount: 100_000 });
    expect(sum(plan)).toBe(600_000);
  });

  it("reparte con piso y resto en la última, igual que un préstamo nuevo", () => {
    const plan = calculateImportedLoan(
      imported({ pendingBalance: 1_000_000, installmentCount: 3 }),
    );
    expect(plan.installments.map((i) => i.amount)).toEqual([333_333, 333_333, 333_334]);
  });

  it("acepta un saldo igual al total, y rechaza un saldo mayor que el total, cero o con decimales", () => {
    expect(calculateImportedLoan(imported({ pendingBalance: 1_200_000 })).scheduled).toBe(
      1_200_000,
    );
    for (const [pendingBalance, code] of [
      [1_200_001, "PENDING_EXCEEDS_TOTAL"],
      [0, "INVALID_PENDING_BALANCE"],
      [-5, "INVALID_PENDING_BALANCE"],
      [10.5, "INVALID_PENDING_BALANCE"],
      [5, "INSTALLMENTS_EXCEED_TOTAL"],
    ] as const) {
      expect(
        () => calculateImportedLoan(imported({ pendingBalance })),
        String(pendingBalance),
      ).toThrow(expect.objectContaining({ code }));
    }
  });

  it("una próxima fecha de cobro pasada es válida (representa mora anterior) y las demás validaciones aplican", () => {
    const plan = calculateImportedLoan(
      imported({ firstDueOn: isoDate("2020-01-15"), frequency: "MENSUAL" }),
    );
    expect(plan.installments[0]!.dueOn).toBe("2020-01-15");
    expect(plan.installments[5]!.dueOn).toBe("2020-06-15");
    expect(() => calculateImportedLoan(imported({ installmentCount: 0 }))).toThrow(AppError);
    expect(() => calculateImportedLoan(imported({ firstDueOn: "2026-02-30" as never }))).toThrow(
      AppError,
    );
  });
});

describe("montos por cuota de un préstamo importado (02 §6.1)", () => {
  const imported = (overrides: Partial<ImportedLoanTerms> = {}): ImportedLoanTerms => ({
    ...terms(),
    pendingBalance: 600_000,
    installmentCount: 3,
    firstDueOn: isoDate("2026-10-20"),
    ...overrides,
  });

  it("sin montos propone el reparto en partes iguales y no lo marca como cambiado", () => {
    const plan = calculateImportedLoan(imported({ pendingBalance: 1_000_000 }));
    expect(plan.installments.map((i) => i.amount)).toEqual([333_333, 333_333, 333_334]);
    expect(plan.customAmounts).toBe(false);
  });

  it("usa los montos escritos si suman exactamente el saldo, con fechas y numeración del calendario", () => {
    const plan = calculateImportedLoan(
      imported({ frequency: "SEMANAL", installmentAmounts: [50_000, 250_000, 300_000] }),
    );
    expect(plan.installments).toEqual([
      { number: 1, dueOn: "2026-10-20", amount: 50_000 },
      { number: 2, dueOn: "2026-10-27", amount: 250_000 },
      { number: 3, dueOn: "2026-11-03", amount: 300_000 },
    ]);
    expect(plan.scheduled).toBe(600_000);
    expect(plan.customAmounts).toBe(true);
  });

  it("enviar exactamente el reparto propuesto no cuenta como cambio", () => {
    const plan = calculateImportedLoan(
      imported({ installmentAmounts: [200_000, 200_000, 200_000] }),
    );
    expect(plan.customAmounts).toBe(false);
  });

  it("rechaza una suma distinta del saldo, por un peso de más o de menos", () => {
    for (const installmentAmounts of [
      [200_000, 200_000, 199_999],
      [200_000, 200_000, 200_001],
    ]) {
      expect(
        () => calculateImportedLoan(imported({ installmentAmounts })),
        installmentAmounts.join(","),
      ).toThrow(expect.objectContaining({ code: "INSTALLMENT_AMOUNTS_SUM_MISMATCH", status: 400 }));
    }
    expect(() =>
      calculateImportedLoan(imported({ installmentAmounts: [200_000, 200_000, 199_999] })),
    ).toThrow("Las cuotas suman $599.999 y el saldo pendiente es $600.000");
  });

  it("una suma enorme no se desborda: se rechaza como mayor que el saldo", () => {
    const huge = Number.MAX_SAFE_INTEGER - 1;
    expect(() =>
      calculateImportedLoan(imported({ installmentAmounts: [huge, huge, huge] })),
    ).toThrow(expect.objectContaining({ code: "INSTALLMENT_AMOUNTS_SUM_MISMATCH" }));
  });

  it("rechaza una cantidad de montos distinta del número de cuotas", () => {
    for (const installmentAmounts of [[600_000], [100_000, 100_000, 100_000, 300_000], []]) {
      expect(() => calculateImportedLoan(imported({ installmentAmounts }))).toThrow(
        expect.objectContaining({ code: "INSTALLMENT_AMOUNTS_COUNT_MISMATCH" }),
      );
    }
  });

  it("rechaza montos en cero, negativos o con decimales aunque la suma cuadre", () => {
    for (const installmentAmounts of [
      [0, 300_000, 300_000],
      [-100_000, 350_000, 350_000],
      [100_000.5, 199_999.5, 300_000],
    ]) {
      expect(
        () => calculateImportedLoan(imported({ installmentAmounts })),
        installmentAmounts.join(","),
      ).toThrow(expect.objectContaining({ code: "INVALID_INSTALLMENT_AMOUNT" }));
    }
  });
});

describe("descuadre histórico de un préstamo importado (02 §6.1)", () => {
  const plan = { total: 1_200_000, scheduled: 700_000 } as Parameters<
    typeof historicalDifference
  >[0];

  it("es total − pagado − pendiente, y no existe si no se conoce lo pagado", () => {
    expect(historicalDifference(plan, 500_000)).toBe(0);
    expect(historicalDifference(plan, 100_000)).toBe(400_000);
    expect(historicalDifference(plan, 600_000)).toBe(-100_000);
    expect(historicalDifference(plan, 0)).toBe(500_000);
    expect(historicalDifference(plan, undefined)).toBeNull();
  });

  it("si cuadra (o no hay dato) no exige nada ni devuelve observación", () => {
    expect(assertMismatchAcknowledged(money(0), {})).toBeNull();
    expect(assertMismatchAcknowledged(null, {})).toBeNull();
    expect(assertMismatchAcknowledged(money(0), { confirmMismatch: true, mismatchNote: "x" })).toBe(
      null,
    );
  });

  it("si no cuadra exige confirmación explícita (409) y una observación no vacía (400)", () => {
    for (const difference of [money(400_000), money(-1)]) {
      expect(() => assertMismatchAcknowledged(difference, {})).toThrow(
        expect.objectContaining({ code: "IMPORT_MISMATCH_UNCONFIRMED", status: 409 }),
      );
      expect(() =>
        assertMismatchAcknowledged(difference, { confirmMismatch: false, mismatchNote: "Abonos" }),
      ).toThrow(expect.objectContaining({ code: "IMPORT_MISMATCH_UNCONFIRMED" }));
      for (const mismatchNote of [undefined, "", "   "]) {
        expect(() =>
          assertMismatchAcknowledged(difference, { confirmMismatch: true, mismatchNote }),
        ).toThrow(expect.objectContaining({ code: "IMPORT_MISMATCH_NOTE_REQUIRED", status: 400 }));
      }
    }
  });

  it("con confirmación y observación devuelve la observación para la auditoría", () => {
    expect(
      assertMismatchAcknowledged(money(400_000), {
        confirmMismatch: true,
        mismatchNote: "  Abonos de interés sin registrar ",
      }),
    ).toBe("Abonos de interés sin registrar");
  });
});
