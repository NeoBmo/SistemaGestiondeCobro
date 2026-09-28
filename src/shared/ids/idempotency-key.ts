import { AppError } from "../errors/app-error";

/** Clave de idempotencia de un comando financiero: UUID en minúsculas (03-ARQUITECTURA §3). */
declare const idempotencyKeyBrand: unique symbol;
export type IdempotencyKey = string & { readonly [idempotencyKeyBrand]: true };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isIdempotencyKey(value: unknown): value is IdempotencyKey {
  return typeof value === "string" && UUID.test(value);
}

/** Valida y normaliza a minúsculas; lanza `INVALID_IDEMPOTENCY_KEY` (400) si no es un UUID. */
export function parseIdempotencyKey(value: unknown): IdempotencyKey {
  const normalized = typeof value === "string" ? value.toLowerCase() : value;
  if (!isIdempotencyKey(normalized)) {
    throw new AppError(
      "INVALID_IDEMPOTENCY_KEY",
      "La clave de idempotencia debe ser un UUID válido",
    );
  }
  return normalized;
}
