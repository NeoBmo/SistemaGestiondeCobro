import { describe, expect, it } from "vitest";
import {
  MAX_MOVEMENT_AMOUNT,
  adjustmentSchema,
  expenseSchema,
  openingBalanceSchema,
  reversalSchema,
} from "./validation";

describe("importes", () => {
  it("acepta enteros positivos hasta el tope y rechaza decimales, cero, negativos y textos", () => {
    expect(openingBalanceSchema.safeParse({ amount: 1 }).success).toBe(true);
    expect(openingBalanceSchema.safeParse({ amount: MAX_MOVEMENT_AMOUNT }).success).toBe(true);
    for (const amount of [0, -1, 1.5, MAX_MOVEMENT_AMOUNT + 1, "100", null, Number.NaN]) {
      expect(openingBalanceSchema.safeParse({ amount }).success, String(amount)).toBe(false);
    }
  });
});

describe("gasto", () => {
  it("la categoría OTRO exige observación; las demás no", () => {
    expect(expenseSchema.safeParse({ amount: 10, category: "OTRO" }).success).toBe(false);
    expect(expenseSchema.safeParse({ amount: 10, category: "OTRO", note: "  " }).success).toBe(
      false,
    );
    expect(
      expenseSchema.safeParse({ amount: 10, category: "OTRO", note: "Papelería" }).success,
    ).toBe(true);
    expect(expenseSchema.safeParse({ amount: 10, category: "GASOLINA" }).success).toBe(true);
    expect(expenseSchema.safeParse({ amount: 10, category: "VIAJES" }).success).toBe(false);
  });
});

describe("ajuste y reverso", () => {
  it("exigen motivo y una dirección o un id válidos; el byte nulo no pasa", () => {
    expect(adjustmentSchema.safeParse({ direction: "ENTRADA", amount: 5 }).success).toBe(false);
    expect(
      adjustmentSchema.safeParse({ direction: "ENTRADA", amount: 5, reason: "  " }).success,
    ).toBe(false);
    expect(adjustmentSchema.safeParse({ direction: "AMBAS", amount: 5, reason: "x" }).success).toBe(
      false,
    );
    expect(
      adjustmentSchema.safeParse({ direction: "SALIDA", amount: 5, reason: "x" }).success,
    ).toBe(true);
    expect(reversalSchema.safeParse({ movementId: "abc", reason: "x" }).success).toBe(false);
    expect(
      reversalSchema.safeParse({
        movementId: "0b6f6e1c-6c51-4e9a-9d2b-3f1a2b3c4d5e",
        reason: "a\0b",
      }).success,
    ).toBe(false);
  });
  it("la observación admite hasta 500 caracteres y una vacía equivale a no enviarla", () => {
    expect(openingBalanceSchema.safeParse({ amount: 1, note: "x".repeat(500) }).success).toBe(true);
    expect(openingBalanceSchema.safeParse({ amount: 1, note: "x".repeat(501) }).success).toBe(
      false,
    );
    expect(openingBalanceSchema.parse({ amount: 1, note: "   " })).toEqual({ amount: 1 });
  });
});
