import { describe, expect, it } from "vitest";
import { passwordIssues } from "./password-policy";
import { generateTemporaryPassword } from "./temporary-password";

// 02-DOMINIO §1.4: contraseña inicial temporal; el usuario debe cambiarla en el primer acceso.

describe("generateTemporaryPassword", () => {
  it("siempre cumple la política de contraseñas (8+ con letra y dígito)", () => {
    for (let i = 0; i < 500; i++) {
      expect(passwordIssues(generateTemporaryPassword())).toEqual([]);
    }
  });

  it("tiene 12 caracteres y evita los ambiguos al dictarla o teclearla (0 O 1 l I)", () => {
    for (let i = 0; i < 200; i++) {
      const password = generateTemporaryPassword();
      expect(password).toHaveLength(12);
      expect(password).not.toMatch(/[0O1lI]/);
      expect(password).toMatch(/^[A-Za-z0-9]+$/);
    }
  });

  it("no se repite (aleatoria criptográfica)", () => {
    const passwords = new Set(Array.from({ length: 200 }, () => generateTemporaryPassword()));

    expect(passwords.size).toBe(200);
  });
});
