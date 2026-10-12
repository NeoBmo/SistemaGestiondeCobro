/**
 * Textos y reglas de presentación de la Caja Mayor, puros para poder usarse en servidor y navegador.
 * El color nunca es el único portador del significado (frontend-design §6): cada tipo lleva texto, y la
 * dirección, signo y flecha.
 */

/** Tipos que nacen en F2 y que el Admin puede reversar aquí; los de F3+ se reversan en sus fases. */
export const REVERSIBLE_TYPES = [
  "SALDO_APERTURA",
  "INGRESO_CAPITAL",
  "GASTO_CAJA_MAYOR",
  "AJUSTE",
] as const;

export const MOVEMENT_LABEL: Record<string, string> = {
  SALDO_APERTURA: "Saldo de apertura",
  INGRESO_CAPITAL: "Ingreso de capital",
  DESEMBOLSO_PRESTAMO: "Desembolso de préstamo",
  FONDO_OPERATIVO: "Fondo operativo",
  COBRO: "Cobro",
  GASTO_COBRADOR: "Gasto de cobrador",
  GASTO_CAJA_MAYOR: "Gasto de Caja Mayor",
  LIQUIDACION: "Liquidación",
  DIFERENCIA_CAJA: "Diferencia de caja",
  AJUSTE: "Ajuste",
  REVERSO: "Reverso",
};

export const CATEGORY_LABEL: Record<string, string> = {
  GASOLINA: "Gasolina",
  ALIMENTACION: "Alimentación",
  REPARACION: "Reparación",
  MEDICINA: "Medicina",
  OTRO: "Otro",
};

export const DIRECTION_LABEL = { ENTRADA: "Entrada", SALIDA: "Salida" } as const;

/** Un movimiento se puede reversar si es de un tipo de F2, no es ya un reverso y no fue reversado. */
export function canReverseMovement(movement: {
  type: string;
  reversedByMovementId: string | null;
}): boolean {
  return (
    (REVERSIBLE_TYPES as readonly string[]).includes(movement.type) &&
    movement.reversedByMovementId === null
  );
}
