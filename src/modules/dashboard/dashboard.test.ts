import { describe, expect, it } from "vitest";
import { isoDate } from "@/shared/dates/dates";
import { isPeriod, periodRange } from "./periods";
import { dashboardConfigSchema } from "./settings";
import { WIDGETS, resolveDashboardConfig } from "./widgets";

describe("periodRange", () => {
  const today = isoDate("2026-10-15");

  it("los 7 y 30 días son móviles e incluyen hoy", () => {
    expect(periodRange("7D", today)).toEqual({ from: "2026-10-09", to: "2026-10-15" });
    expect(periodRange("30D", today)).toEqual({ from: "2026-09-16", to: "2026-10-15" });
  });

  it("el mes y el año son calendario hasta hoy", () => {
    expect(periodRange("MONTH", today)).toEqual({ from: "2026-10-01", to: "2026-10-15" });
    expect(periodRange("YEAR", today)).toEqual({ from: "2026-01-01", to: "2026-10-15" });
    expect(periodRange("MONTH", isoDate("2026-03-01"))).toEqual({
      from: "2026-03-01",
      to: "2026-03-01",
    });
  });

  it("cruza el fin de año sin errores", () => {
    expect(periodRange("7D", isoDate("2027-01-03"))).toEqual({
      from: "2026-12-28",
      to: "2027-01-03",
    });
  });

  it("reconoce solo periodos conocidos", () => {
    expect(isPeriod("7D")).toBe(true);
    expect(isPeriod("WEEK")).toBe(false);
    expect(isPeriod(undefined)).toBe(false);
  });
});

describe("resolveDashboardConfig", () => {
  it("el plan semanal siempre ve el predeterminado y no es configurable", () => {
    const saved = { period: "YEAR", widgets: ["CASH_BALANCE"] };
    expect(resolveDashboardConfig("SEMANAL", saved)).toEqual({
      period: "7D",
      widgets: [...WIDGETS],
      configurable: false,
    });
    expect(resolveDashboardConfig(null, null).configurable).toBe(false);
  });

  it("mensual y anual ven lo guardado o, sin nada guardado, todos los indicadores a 30 días", () => {
    expect(resolveDashboardConfig("MENSUAL", null)).toEqual({
      period: "30D",
      widgets: [...WIDGETS],
      configurable: true,
    });
    expect(
      resolveDashboardConfig("ANUAL", { period: "YEAR", widgets: ["SPENT", "CASH_BALANCE"] }),
    ).toEqual({ period: "YEAR", widgets: ["SPENT", "CASH_BALANCE"], configurable: true });
  });

  it("ignora indicadores o periodos desconocidos guardados", () => {
    expect(
      resolveDashboardConfig("MENSUAL", { period: "WEEK", widgets: ["CASH_BALANCE", "NOPE"] }),
    ).toEqual({ period: "30D", widgets: ["CASH_BALANCE"], configurable: true });
  });
});

describe("dashboardConfigSchema", () => {
  it("acepta una selección ordenada, incluso vacía", () => {
    expect(
      dashboardConfigSchema.safeParse({ period: "MONTH", widgets: ["SPENT", "COLLECTED"] }).success,
    ).toBe(true);
    expect(dashboardConfigSchema.safeParse({ period: "7D", widgets: [] }).success).toBe(true);
  });

  it("rechaza periodos o indicadores inválidos y repetidos", () => {
    for (const body of [
      { period: "WEEK", widgets: [] },
      { period: "7D", widgets: ["NOPE"] },
      { period: "7D", widgets: ["SPENT", "SPENT"] },
      { period: "7D" },
      { widgets: [] },
    ]) {
      expect(dashboardConfigSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });
});
