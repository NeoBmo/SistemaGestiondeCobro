import { randomInt } from "node:crypto";

// Sin 0, O, 1, l ni I: se dicta o se teclea en el celular y se confunden.
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const DIGITS = "23456789";
const ALPHABET = LETTERS + DIGITS;
const LENGTH = 12;

const pick = (characters: string) => characters[randomInt(characters.length)]!;

/**
 * Contraseña inicial temporal (02-DOMINIO §1.4). Aleatoria criptográfica y con al menos una letra y
 * un dígito para cumplir la política. No se almacena: se muestra una sola vez a quien crea la cuenta.
 */
export function generateTemporaryPassword(): string {
  const characters = [pick(LETTERS), pick(DIGITS)];
  while (characters.length < LENGTH) characters.push(pick(ALPHABET));
  // Fisher–Yates: las posiciones de la letra y el dígito obligatorios no son predecibles.
  for (let i = characters.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [characters[i], characters[j]] = [characters[j]!, characters[i]!];
  }
  return characters.join("");
}
