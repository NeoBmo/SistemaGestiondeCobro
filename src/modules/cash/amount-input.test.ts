import { describe, expect, it } from "vitest";
import { parseAmountInput } from "./amount-input";
import { MAX_MOVEMENT_AMOUNT } from "./validation";

describe("parseAmountInput", () => {
  it("acepta pesos enteros con o sin puntos de miles y con signo de pesos", () => {
    for (const [text, amount] of [
      ["150000", 150_000],
      ["150.000", 150_000],
      ["$ 1.500.000", 1_500_000],
      [" 7 ", 7],
    ] as const) {
      expect(parseAmountInput(text), text).toEqual({ ok: true, amount });
    }
  });

  it("rechaza vacío, decimales, cero, negativos, texto y lo que pasa el tope, con un mensaje", () => {
    for (const text of [
      "",
      "  ",
      "12,5",
      "12.5",
      "0",
      "-5",
      "abc",
      "1e5",
      String(MAX_MOVEMENT_AMOUNT + 1),
    ]) {
      const result = parseAmountInput(text);
      expect(result.ok, text).toBe(false);
      if (!result.ok) expect(result.message.length).toBeGreaterThan(0);
    }
  });
});
