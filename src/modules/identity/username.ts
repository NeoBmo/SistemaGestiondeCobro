import { AppError } from "@/shared/errors/app-error";

/** Mismo formato que el CHECK de `profiles.username` (ADR 0002): es la parte local del email sintético. */
const USERNAME = /^[a-z0-9._-]{3,32}$/;

export function normalizeUsername(input: string): string {
  return input.trim().toLowerCase();
}

export function isValidUsername(username: string): boolean {
  return USERNAME.test(username);
}

/** Normaliza y valida; lanza `INVALID_USERNAME` (400) si el resultado no cumple el formato. */
export function parseUsername(input: string): string {
  const username = normalizeUsername(input);
  if (!isValidUsername(username)) {
    throw new AppError(
      "INVALID_USERNAME",
      "El usuario debe tener de 3 a 32 caracteres: letras minúsculas sin acentos, dígitos, punto, guion o guion bajo",
    );
  }
  return username;
}
