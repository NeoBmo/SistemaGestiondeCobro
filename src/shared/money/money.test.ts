import { describe, expect, it } from "vitest";
import { AppError } from "../errors/app-error";
import {
  addMoney,
  computeInterest,
  formatMoney,
  interestBpsFromPercent,
  money,
  parseMoneyInput,
  subtractMoney,
} from "./money";

describe("money()", () => {
  it("acepta enteros seguros, incluidos cero y negativos (diferencias de caja)", () => {
    expect(money(0)).toBe(0);
    expect(money(1_000_000)).toBe(1_000_000);
    expect(money(-500)).toBe(-500);
  });

  it("rechaza decimales, NaN e infinitos", () => {
    for (const bad of [1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => money(bad)).toThrow(AppError);
    }
  });

  it("rechaza enteros fuera del rango seguro de JS", () => {
    expect(() => money(Number.MAX_SAFE_INTEGER + 1)).toThrow(AppError);
  });

  it("convierte bigint y texto entero (como los entrega pg para bigint)", () => {
    expect(money(1_200_000n)).toBe(1_200_000);
    expect(money("1200000")).toBe(1_200_000);
    expect(money("-50")).toBe(-50);
  });

  it("rechaza bigint fuera de rango seguro y texto no entero", () => {
    expect(() => money(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toThrow(AppError);
    expect(() => money("12.5")).toThrow(AppError);
    expect(() => money("1e6")).toThrow(AppError);
    expect(() => money("")).toThrow(AppError);
  });

  it("el error es INVALID_MONEY con status 400", () => {
    try {
      money(0.1);
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ code: "INVALID_MONEY", status: 400 });
    }
  });
});

describe("addMoney / subtractMoney", () => {
  it("suman y restan enteros exactos (sin error de punto flotante)", () => {
    expect(addMoney(money(100_000), money(50_000))).toBe(150_000);
    expect(subtractMoney(money(100_000), money(150_000))).toBe(-50_000);
  });

  it("rechazan resultados fuera del rango seguro", () => {
    expect(() => addMoney(money(Number.MAX_SAFE_INTEGER), money(1))).toThrow(AppError);
  });
});

describe("formatMoney", () => {
  it("formatea COP sin decimales con separador de miles", () => {
    expect(formatMoney(money(1_000_000))).toBe("$1.000.000");
    expect(formatMoney(money(100_000))).toBe("$100.000");
    expect(formatMoney(money(0))).toBe("$0");
  });

  it("pone el signo antes del símbolo en negativos", () => {
    expect(formatMoney(money(-50_000))).toBe("-$50.000");
  });
});

describe("parseMoneyInput", () => {
  it("interpreta entradas habituales de un formulario", () => {
    expect(parseMoneyInput("1000000")).toBe(1_000_000);
    expect(parseMoneyInput("1.000.000")).toBe(1_000_000);
    expect(parseMoneyInput("$1.000.000")).toBe(1_000_000);
    expect(parseMoneyInput("  $ 50.000  ")).toBe(50_000);
    expect(parseMoneyInput("0")).toBe(0);
  });

  it("es el inverso de formatMoney", () => {
    for (const value of [0, 7, 999, 1_000, 123_456_789]) {
      expect(parseMoneyInput(formatMoney(money(value)))).toBe(value);
    }
  });

  it("devuelve null para entradas inválidas o con decimales (COP no los usa)", () => {
    for (const bad of ["", "abc", "1,5", "1.5", "1.000,50", "12.34.567", "1e6", "--5", "$"]) {
      expect(parseMoneyInput(bad)).toBeNull();
    }
  });

  it("devuelve null fuera del rango seguro", () => {
    expect(parseMoneyInput("99999999999999999999")).toBeNull();
  });
});

describe("interestBpsFromPercent", () => {
  it("convierte porcentaje a puntos básicos enteros (02-DOMINIO §2.3)", () => {
    expect(interestBpsFromPercent(20)).toBe(2000);
    expect(interestBpsFromPercent(12.5)).toBe(1250);
    expect(interestBpsFromPercent(0)).toBe(0);
    expect(interestBpsFromPercent(0.07 * 100)).toBe(700);
  });

  it("rechaza negativos, NaN y precisión menor a un punto básico", () => {
    expect(() => interestBpsFromPercent(-1)).toThrow(AppError);
    expect(() => interestBpsFromPercent(Number.NaN)).toThrow(AppError);
    expect(() => interestBpsFromPercent(12.345)).toThrow(AppError);
  });
});

describe("computeInterest (round-half-up, 02-DOMINIO §2.4)", () => {
  it("$1.000.000 al 20 % → $200.000 (total $1.200.000)", () => {
    expect(computeInterest(money(1_000_000), 2000)).toBe(200_000);
  });

  it("redondea .5 hacia arriba", () => {
    // 4 × 12,5 % = 0,5 → 1
    expect(computeInterest(money(4), 1250)).toBe(1);
    // 1 × 50 % = 0,5 → 1
    expect(computeInterest(money(1), 5000)).toBe(1);
  });

  it("redondea por debajo de .5 hacia abajo", () => {
    // 3 × 12,5 % = 0,375 → 0
    expect(computeInterest(money(3), 1250)).toBe(0);
    // 1 × 49,99 % = 0,4999 → 0
    expect(computeInterest(money(1), 4999)).toBe(0);
  });

  it("redondea por encima de .5 hacia arriba", () => {
    // 5 × 12,5 % = 0,625 → 1
    expect(computeInterest(money(5), 1250)).toBe(1);
  });

  it("interés cero con 0 bps o principal cero", () => {
    expect(computeInterest(money(1_000_000), 0)).toBe(0);
    expect(computeInterest(money(0), 2000)).toBe(0);
  });

  it("no pierde precisión con principales grandes (usa aritmética entera)", () => {
    // 9.000.000.000.000 × 12,5 % = 1.125.000.000.000
    expect(computeInterest(money(9_000_000_000_000), 1250)).toBe(1_125_000_000_000);
  });

  it("rechaza principal negativo y bps inválidos", () => {
    expect(() => computeInterest(money(-1), 2000)).toThrow(AppError);
    expect(() => computeInterest(money(100), -1)).toThrow(AppError);
    expect(() => computeInterest(money(100), 12.5)).toThrow(AppError);
  });
});
