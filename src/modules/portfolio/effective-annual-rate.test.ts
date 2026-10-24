import { describe, expect, it } from "vitest";
import { daysBetween, isoDate } from "@/shared/dates/dates";
import {
  MAX_EFFECTIVE_ANNUAL_RATE_BPS,
  effectiveAnnualRate,
  formatRateBps,
  type RateFlows,
} from "./effective-annual-rate";
import { calculateLoan, type LoanFrequency } from "./loan-calculation";

// TEA equivalente por TIR de los flujos (02 §2.3). Los valores de referencia de los préstamos con varias
// cuotas se calcularon aparte, con bisección en `decimal` de Python a 60 dígitos sobre los mismos flujos
// (calendario de `calculateLoan`, base 365); aquí se comparan ya redondeados a puntos básicos.

function flowsOf(
  principal: number,
  interestBps: number,
  frequency: LoanFrequency,
  installmentCount: number,
  disbursedOn: string,
  firstDueOn: string,
): RateFlows {
  const plan = calculateLoan({
    principal,
    interestBps,
    frequency,
    installmentCount,
    firstDueOn: isoDate(firstDueOn),
  });
  return { principal, disbursedOn: isoDate(disbursedOn), installments: plan.installments };
}

/** Valor presente de los flujos a una TEA dada: debe ser ~0 en la TEA calculada. */
function presentValueAt(flows: RateFlows, annualBps: number): number {
  const annual = annualBps / 10_000;
  return (
    flows.installments.reduce(
      (sum, { dueOn, amount }) =>
        sum + amount / Math.pow(1 + annual, daysBetween(flows.disbursedOn, dueOn) / 365),
      0,
    ) - flows.principal
  );
}

describe("effectiveAnnualRate", () => {
  it("una sola cuota a 365 días: la TEA es el interés simple (calculado a mano)", () => {
    // 1.000.000 → 1.100.000 en exactamente un año: 10 % E.A. = 1000 pb.
    const rate = effectiveAnnualRate({
      principal: 1_000_000,
      disbursedOn: isoDate("2027-01-01"),
      installments: [{ dueOn: isoDate("2028-01-01"), amount: 1_100_000 }],
    });
    expect(rate).toEqual({ bps: 1000, capped: false });
  });

  it("una sola cuota a 30 días con 2 %: TEA = 1,02^(365/30) − 1 (calculado a mano)", () => {
    // 1,02^(365/30) = 1,272434462…; TEA = 27,2434462… % → 2724 pb (half-up).
    const rate = effectiveAnnualRate({
      principal: 1_000_000,
      disbursedOn: isoDate("2026-01-01"),
      installments: [{ dueOn: isoDate("2026-01-31"), amount: 1_020_000 }],
    });
    expect(rate.bps).toBe(Math.floor((Math.pow(1.02, 365 / 30) - 1) * 10_000 + 0.5));
    expect(rate).toEqual({ bps: 2724, capped: false });
  });

  it("mensual, 12 cuotas: 20 % de interés total da 41,51 % E.A.", () => {
    // 12 cuotas de $100.000 del 15 de febrero de 2026 al 15 de enero de 2027 por $1.000.000.
    const flows = flowsOf(1_000_000, 2000, "MENSUAL", 12, "2026-01-15", "2026-02-15");
    const rate = effectiveAnnualRate(flows);
    expect(rate).toEqual({ bps: 4151, capped: false }); // referencia: 41,5133630… %
    expect(Math.abs(presentValueAt(flows, 4151.3363))).toBeLessThan(1);
  });

  it("mensual, 12 cuotas: 14 % queda por debajo de una usura de 28,59 % y 15 % la supera", () => {
    expect(
      effectiveAnnualRate(flowsOf(1_000_000, 1400, "MENSUAL", 12, "2026-01-15", "2026-02-15")),
    ).toEqual({ bps: 2809, capped: false }); // referencia: 28,0935365… %
    expect(
      effectiveAnnualRate(flowsOf(1_000_000, 1500, "MENSUAL", 12, "2026-01-15", "2026-02-15")),
    ).toEqual({ bps: 3027, capped: false }); // referencia: 30,2704143… %
  });

  it("diaria, 12 cuotas (el ejemplo del dominio: 20 %): unos 3,7 millones % E.A.", () => {
    const flows = flowsOf(1_000_000, 2000, "DIARIA", 12, "2026-10-13", "2026-10-14");
    // referencia: 3.688.101,0965065… % → 368.810.110 pb.
    expect(effectiveAnnualRate(flows)).toEqual({ bps: 368_810_110, capped: false });
  });

  it("semanal: 4 y 10 cuotas al 20 %", () => {
    expect(
      effectiveAnnualRate(flowsOf(1_000_000, 2000, "SEMANAL", 4, "2026-10-13", "2026-10-20")),
    ).toEqual({ bps: 471_648, capped: false }); // referencia: 4.716,4849252… %
    expect(
      effectiveAnnualRate(flowsOf(1_000_000, 2000, "SEMANAL", 10, "2026-10-13", "2026-10-20")),
    ).toEqual({ bps: 48_927, capped: false }); // referencia: 489,2677441… %
  });

  it("sin interés la TEA es cero", () => {
    expect(
      effectiveAnnualRate(flowsOf(1_200_000, 0, "MENSUAL", 12, "2026-01-15", "2026-02-15")),
    ).toEqual({ bps: 0, capped: false });
  });

  it("más cuotas por el mismo interés total bajan la TEA (el dinero se devuelve más tarde)", () => {
    const short = effectiveAnnualRate(
      flowsOf(1_000_000, 2000, "SEMANAL", 4, "2026-10-13", "2026-10-20"),
    );
    const long = effectiveAnnualRate(
      flowsOf(1_000_000, 2000, "SEMANAL", 10, "2026-10-13", "2026-10-20"),
    );
    expect(long.bps).toBeLessThan(short.bps);
  });

  it("interés cobrado el mismo día del desembolso: la tasa llega al tope", () => {
    const rate = effectiveAnnualRate({
      principal: 1_000_000,
      disbursedOn: isoDate("2026-10-13"),
      installments: [{ dueOn: isoDate("2026-10-13"), amount: 1_200_000 }],
    });
    expect(rate).toEqual({ bps: MAX_EFFECTIVE_ANNUAL_RATE_BPS, capped: true });
  });

  it("rechaza flujos que no son de un préstamo válido", () => {
    const disbursedOn = isoDate("2026-10-13");
    const due = isoDate("2026-10-20");
    expect(() =>
      effectiveAnnualRate({ principal: 0, disbursedOn, installments: [{ dueOn: due, amount: 1 }] }),
    ).toThrow();
    expect(() => effectiveAnnualRate({ principal: 100, disbursedOn, installments: [] })).toThrow();
    expect(() =>
      effectiveAnnualRate({
        principal: 100,
        disbursedOn,
        installments: [{ dueOn: isoDate("2026-10-12"), amount: 120 }],
      }),
    ).toThrow();
    expect(() =>
      effectiveAnnualRate({
        principal: 100,
        disbursedOn,
        installments: [{ dueOn: due, amount: 90 }],
      }),
    ).toThrow();
  });
});

describe("formatRateBps", () => {
  it("formatea puntos básicos como porcentaje colombiano", () => {
    expect(formatRateBps(2859)).toBe("28,59 %");
    expect(formatRateBps(5)).toBe("0,05 %");
    expect(formatRateBps(0)).toBe("0,00 %");
    expect(formatRateBps(368_810_110)).toBe("3.688.101,10 %");
  });
});
