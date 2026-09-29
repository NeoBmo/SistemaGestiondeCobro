import { describe, expect, it } from "vitest";
import { isoDate } from "@/shared/dates/dates";
import { PLAN_CODES, isPlanCode, subscriptionExpiry } from "./plans";

// 02-DOMINIO §1.1 y §1.3: semanal 7 días, mensual 1 mes, anual 1 año (calendario con ajuste).

describe("planes", () => {
  it("reconoce solo los tres planes V1", () => {
    expect([...PLAN_CODES]).toEqual(["SEMANAL", "MENSUAL", "ANUAL"]);
    expect(isPlanCode("MENSUAL")).toBe(true);
    for (const bad of ["TRIMESTRAL", "mensual", "", null, 3]) {
      expect(isPlanCode(bad), String(bad)).toBe(false);
    }
  });
});

describe("subscriptionExpiry", () => {
  const start = isoDate("2026-01-31");

  it("SEMANAL: inicio + 7 días", () => {
    expect(subscriptionExpiry("SEMANAL", start)).toBe("2026-02-07");
  });

  it("MENSUAL: mismo día del mes siguiente, ajustado a fin de mes", () => {
    expect(subscriptionExpiry("MENSUAL", start)).toBe("2026-02-28");
    expect(subscriptionExpiry("MENSUAL", isoDate("2026-09-28"))).toBe("2026-10-28");
  });

  it("ANUAL: mismo día del año siguiente, ajustado a fin de mes", () => {
    expect(subscriptionExpiry("ANUAL", isoDate("2026-09-28"))).toBe("2027-09-28");
    expect(subscriptionExpiry("ANUAL", isoDate("2028-02-29"))).toBe("2029-02-28");
  });

  it("el vencimiento siempre es posterior al inicio (CHECK de la BD)", () => {
    for (const plan of PLAN_CODES) {
      expect(subscriptionExpiry(plan, start) > start, plan).toBe(true);
    }
  });
});
