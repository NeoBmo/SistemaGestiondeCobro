import { z } from "zod";

// Postgres (`text`) rechaza el byte nulo; se prohíbe aquí para dar 400 en vez de un 500 tardío.
const text = (label: string) =>
  z
    .string()
    .trim()
    .refine((value) => !value.includes("\0"), `${label} no puede contener el carácter nulo`);

/**
 * Tope técnico por movimiento (1 billón de pesos): con él la suma de miles de movimientos sigue siendo
 * un entero seguro de JS (regla 8). No es una regla de negocio.
 */
export const MAX_MOVEMENT_AMOUNT = 1_000_000_000_000;

const amount = z.number().int().positive().max(MAX_MOVEMENT_AMOUNT);
// Una observación vacía es «sin observación»: se guarda NULL y no cambia el hash de idempotencia.
const note = text("La observación")
  .pipe(z.string().max(500))
  .transform((value) => value || undefined)
  .optional();
const reason = text("El motivo").pipe(z.string().min(1).max(500));

export const EXPENSE_CATEGORIES = [
  "GASOLINA",
  "ALIMENTACION",
  "REPARACION",
  "MEDICINA",
  "OTRO",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const openingBalanceSchema = z.object({ amount, note });
export const capitalIncomeSchema = z.object({ amount, note });
export const expenseSchema = z
  .object({ amount, category: z.enum(EXPENSE_CATEGORIES), note })
  // 02 §5.4: la categoría OTRO exige observación.
  .refine((value) => value.category !== "OTRO" || (value.note ?? "").length > 0, {
    message: "La categoría OTRO exige una observación",
    path: ["note"],
  });
export const adjustmentSchema = z.object({
  direction: z.enum(["ENTRADA", "SALIDA"]),
  amount,
  reason,
});
export const reversalSchema = z.object({ movementId: z.uuid(), reason });
