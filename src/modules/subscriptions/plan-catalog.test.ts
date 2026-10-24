import { describe, expect, it } from "vitest";
import { money } from "@/shared/money/money";
import { PLAN_CODES } from "./plans";
import { PLAN_CATALOG, collectorsLabel, dashboardLabel, discountPercent } from "./plan-catalog";

const plan = (code: string) => PLAN_CATALOG.find((entry) => entry.code === code)!;

describe("PLAN_CATALOG", () => {
  it("tiene los tres planes V1, en orden y sin repetir", () => {
    expect(PLAN_CATALOG.map((plan) => plan.code)).toEqual([...PLAN_CODES]);
  });

  it("lleva los precios V1 en COP enteros (02-DOMINIO §1.1)", () => {
    expect(PLAN_CATALOG.map(({ code, priceAmount }) => [code, priceAmount])).toEqual([
      ["SEMANAL", 25_000],
      ["MENSUAL", 100_000],
      ["ANUAL", 960_000],
    ]);
  });

  it("el anual es 12 mensualidades con 20 % de descuento y es el único recomendado", () => {
    const annual = plan("ANUAL");

    expect(annual.referencePriceAmount).toBe(plan("MENSUAL").priceAmount * 12);
    expect(annual.referencePriceAmount).toBe(1_200_000);
    expect(discountPercent(annual.priceAmount, annual.referencePriceAmount!)).toBe(20);
    expect(PLAN_CATALOG.filter((entry) => entry.recommended).map((entry) => entry.code)).toEqual([
      "ANUAL",
    ]);
    expect(plan("SEMANAL").referencePriceAmount).toBeNull();
    expect(plan("MENSUAL").referencePriceAmount).toBeNull();
  });

  it("el plan semanal limita a 5 cobradores y el dashboard no es configurable (01-CONTEXTO)", () => {
    expect(plan("SEMANAL")).toMatchObject({ maxActiveCollectors: 5, dashboardConfigurable: false });
    for (const code of ["MENSUAL", "ANUAL"]) {
      expect(plan(code)).toMatchObject({ maxActiveCollectors: null, dashboardConfigurable: true });
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

  it("discountPercent redondea a entero", () => {
    expect(discountPercent(money(960_000), money(1_200_000))).toBe(20);
    expect(discountPercent(money(100_000), money(100_000))).toBe(0);
  });
});
