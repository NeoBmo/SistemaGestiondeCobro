import { AppError } from "@/shared/errors/app-error";

export const PASSWORD_MIN_LENGTH = 8;
/** bcrypt (Supabase Auth) trunca en silencio lo que pase de 72 bytes: se rechaza en vez de truncar. */
export const PASSWORD_MAX_BYTES = 72;

export type PasswordIssue = "TOO_SHORT" | "TOO_LONG" | "NEEDS_LETTER" | "NEEDS_DIGIT";

const utf8 = new TextEncoder();

/** Política de F1: 8+ caracteres, al menos una letra y un dígito. */
export function passwordIssues(password: string): PasswordIssue[] {
  const issues: PasswordIssue[] = [];
  if ([...password].length < PASSWORD_MIN_LENGTH) issues.push("TOO_SHORT");
  if (utf8.encode(password).length > PASSWORD_MAX_BYTES) issues.push("TOO_LONG");
  if (!/\p{L}/u.test(password)) issues.push("NEEDS_LETTER");
  if (!/\d/.test(password)) issues.push("NEEDS_DIGIT");
  return issues;
}

export function assertValidPassword(password: string): void {
  if (passwordIssues(password).length > 0) {
    throw new AppError(
      "INVALID_PASSWORD",
      `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres (máximo ${PASSWORD_MAX_BYTES} bytes), con al menos una letra y un dígito`,
    );
  }
}
