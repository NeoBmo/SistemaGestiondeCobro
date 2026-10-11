import { describe, expect, it } from "vitest";
import { PLAN_CODES } from "./plans";
import { PLAN_CATALOG, collectorsLabel, dashboardLabel } from "./plan-catalog";

describe("PLAN_CATALOG", () => {
  it("tiene los tres planes V1, en orden y sin repetir", () => {
    expect(PLAN_CATALOG.map((plan) => plan.code)).toEqual([...PLAN_CODES]);
  });

  it("no incluye cifras de precio: siguen pendientes (05-PENDIENTES)", () => {
    expect(JSON.stringify(PLAN_CATALOG)).not.toMatch(/\$|\d{4,}/);
  });

  it("el plan semanal limita a 5 cobradores y el dashboard no es configurable (01-CONTEXTO)", () => {
    const weekly = PLAN_CATALOG.find((plan) => plan.code === "SEMANAL")!;

    expect(weekly).toMatchObject({ maxActiveCollectors: 5, dashboardConfigurable: false });
    for (const code of ["MENSUAL", "ANUAL"]) {
      expect(PLAN_CATALOG.find((plan) => plan.code === code)).toMatchObject({
        maxActiveCollectors: null,
        dashboardConfigurable: true,
      });
    }
  });
});

describe("etiquetas", () => {
  it("collectorsLabel", () => {
    expect(collectorsLabel(5)).toBe("Hasta 5 cobradores activos");
    expect(collectorsLabel(null)).toBe("Cobradores sin límite práctico");
  });

  it("dashboardLabel", () => {
    expect(dashboardLabel(false)).toBe("Dashboard predeterminado");
    expect(dashboardLabel(true)).toBe("Dashboard configurable");
  });
});
