import { describe, expect, it } from "vitest";
import { isoDate } from "@/shared/dates/dates";
import { AppError } from "@/shared/errors/app-error";
import {
  MAX_INSTALLMENTS,
  MAX_INTEREST_BPS,
  MAX_PRINCIPAL,
  calculateLoan,
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

  it("rechaza más cuotas que pesos por pagar (cuotas de cero)", () => {
    expect(codeOf({ principal: 5, interestBps: 0, installmentCount: 6 })).toBe(
      "INSTALLMENTS_EXCEED_TOTAL",
    );
    expect(codeOf({ principal: 6, interestBps: 0, installmentCount: 6 })).toBe("sin error");
  });
});
