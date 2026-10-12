import { parseMoneyInput } from "@/shared/money/money";
import { MAX_MOVEMENT_AMOUNT } from "./validation";

export type AmountParse = { ok: true; amount: number } | { ok: false; message: string };

/**
 * Interpreta el importe que escribe el usuario (`150000`, `150.000`, `$150.000`). Solo pesos enteros
 * positivos dentro del tope: sin decimales, sin cero y sin negativos (la dirección es otro campo).
 */
export function parseAmountInput(text: string): AmountParse {
  if (text.trim() === "") return { ok: false, message: "Ingresa el monto." };
  const value = parseMoneyInput(text);
  if (value === null) {
    return {
      ok: false,
      message: "Escribe un monto en pesos enteros, por ejemplo 150000 o 150.000.",
    };
  }
  if (value <= 0) return { ok: false, message: "El monto debe ser mayor que cero." };
  if (value > MAX_MOVEMENT_AMOUNT) return { ok: false, message: "El monto es demasiado grande." };
  return { ok: true, amount: value };
}
