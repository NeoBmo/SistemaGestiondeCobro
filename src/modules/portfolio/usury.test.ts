import { describe, expect, it } from "vitest";
import type { Tx } from "@/shared/database/with-transaction";
import { isoDate } from "@/shared/dates/dates";
import { money } from "@/shared/money/money";
import type { LoanPlan } from "./loan-calculation";
import {
  assertUsuryAcknowledged,
  assessUsury,
  usuryAuditSummary,
  usuryRateSchema,
  type UsuryAssessment,
} from "./usury";

const usuryRate = {
  id: "r-1",
  rateBps: 2859,
  validFrom: isoDate("2026-10-01"),
  source: "Resolución",
};
const assessment = (overrides: Partial<UsuryAssessment> = {}): UsuryAssessment => ({
  effectiveAnnualRateBps: 3027,
  effectiveAnnualRateCapped: false,
  usuryRate,
  exceeds: true,
  ...overrides,
});

describe("usuryRateSchema", () => {
  it("convierte el porcentaje a puntos básicos y limpia la fuente", () => {
    expect(
      usuryRateSchema.parse({ rate: " 28,59 ", validFrom: "2026-10-01", source: " Res. 1 " }),
    ).toEqual({ rate: 2859, validFrom: "2026-10-01", source: "Res. 1" });
    expect(usuryRateSchema.parse({ rate: "30", validFrom: "2026-10-01", source: "x" }).rate).toBe(
      3000,
    );
  });

  it("rechaza tasas sin sentido, más de dos decimales, fechas inexistentes y fuentes vacías", () => {
    for (const input of [
      { rate: "0", validFrom: "2026-10-01", source: "x" },
      { rate: "28,591", validFrom: "2026-10-01", source: "x" },
      { rate: "1000,01", validFrom: "2026-10-01", source: "x" },
      { rate: "-5", validFrom: "2026-10-01", source: "x" },
      { rate: "28,59", validFrom: "2026-02-30", source: "x" },
      { rate: "28,59", validFrom: "2026-10-01", source: "   " },
      { rate: "28,59", validFrom: "2026-10-01", source: "a\0b" },
    ]) {
      expect(usuryRateSchema.safeParse(input).success, JSON.stringify(input)).toBe(false);
    }
  });
});

describe("assertUsuryAcknowledged", () => {
  it("por encima de la usura exige la marca explícita (409) y explica TEA frente a usura", () => {
    for (const acknowledged of [undefined, false]) {
      expect(() => assertUsuryAcknowledged(assessment(), acknowledged)).toThrow(
        expect.objectContaining({
          code: "USURY_WARNING_NOT_ACKNOWLEDGED",
          status: 409,
          message: expect.stringContaining("(30,27 % E.A.) supera la tasa de usura (28,59 % E.A."),
        }),
      );
    }
    expect(() => assertUsuryAcknowledged(assessment(), true)).not.toThrow();
  });

  it("sin exceso, o sin tasa registrada, no exige nada", () => {
    expect(() => assertUsuryAcknowledged(assessment({ exceeds: false }), undefined)).not.toThrow();
    expect(() =>
      assertUsuryAcknowledged(assessment({ usuryRate: null, exceeds: false }), undefined),
    ).not.toThrow();
  });

  it("una TEA en el tope se describe como «más de»", () => {
    expect(() =>
      assertUsuryAcknowledged(assessment({ effectiveAnnualRateCapped: true }), undefined),
    ).toThrow(/más de 30,27 % E\.A\./);
  });
});

describe("usuryAuditSummary", () => {
  it("registra la TEA, la usura comparada y si se confirmó con advertencia", () => {
    expect(usuryAuditSummary(assessment())).toEqual({
      effectiveAnnualRateBps: 3027,
      effectiveAnnualRateCapped: false,
      usuryRateId: "r-1",
      usuryRateBps: 2859,
      confirmedWithUsuryWarning: true,
    });
    expect(usuryAuditSummary(assessment({ usuryRate: null, exceeds: false }))).toMatchObject({
      usuryRateId: null,
      usuryRateBps: null,
      confirmedWithUsuryWarning: false,
    });
  });
});

describe("assessUsury", () => {
  // Una base falsa que siempre devuelve la usura de 28,59 % E.A.
  const db = {
    query: async () => ({
      rows: [{ id: "r-1", rate_bps: 2859, valid_from: "2026-01-01", source: "Resolución" }],
    }),
  } as unknown as Pick<Tx, "query">;
  /** $1.000.000 que se devuelven en una sola cuota a 365 días: la TEA es (cuota − principal) / principal. */
  const oneYear = (amount: number): LoanPlan => ({
    principal: money(1_000_000),
    interest: money(amount - 1_000_000),
    total: money(amount),
    installments: [{ number: 1, dueOn: isoDate("2027-01-01"), amount: money(amount) }],
  });

  it("advierte un exceso menor que medio punto básico aunque la TEA redondeada iguale la usura", async () => {
    // 28,594 % E.A. (calculado a mano: 285.940 / 1.000.000) se muestra como 28,59 %, pero supera 28,59 %.
    const assessment = await assessUsury(db, oneYear(1_285_940), isoDate("2026-01-01"));
    expect(assessment).toMatchObject({ effectiveAnnualRateBps: 2859, exceeds: true });
  });

  it("por debajo de la usura no advierte", async () => {
    // 28,58 % E.A.
    const assessment = await assessUsury(db, oneYear(1_285_800), isoDate("2026-01-01"));
    expect(assessment).toMatchObject({ effectiveAnnualRateBps: 2858, exceeds: false });
  });
});
