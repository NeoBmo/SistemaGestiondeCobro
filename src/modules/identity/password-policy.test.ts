import { describe, expect, it } from "vitest";
import { AppError } from "@/shared/errors/app-error";
import { assertValidPassword, passwordIssues } from "./password-policy";

// Decisión de F1: 8+ caracteres con al menos una letra y un dígito (05-PENDIENTES, ADR 0004).
// Tope de 72 bytes: bcrypt trunca en silencio lo que exceda.

describe("passwordIssues", () => {
  it("no reporta problemas para contraseñas válidas", () => {
    for (const good of [
      "abcdefg1",
      "Clave2026x",
      "1234567a",
      "contraseña1",
      "x".repeat(71) + "1",
    ]) {
      expect(passwordIssues(good), good).toEqual([]);
    }
  });

  it("exige mínimo 8 caracteres", () => {
    expect(passwordIssues("abc123")).toEqual(["TOO_SHORT"]);
    expect(passwordIssues("")).toContain("TOO_SHORT");
  });

  it("exige al menos una letra y al menos un dígito", () => {
    expect(passwordIssues("12345678")).toEqual(["NEEDS_LETTER"]);
    expect(passwordIssues("abcdefgh")).toEqual(["NEEDS_DIGIT"]);
  });

  it("rechaza más de 72 bytes (bcrypt)", () => {
    expect(passwordIssues("a1" + "x".repeat(71))).toEqual(["TOO_LONG"]);
    // 40 letras de 2 bytes = 80 bytes aunque solo son 40 caracteres
    expect(passwordIssues("ñ".repeat(40) + "1")).toEqual(["TOO_LONG"]);
  });

  it("acumula varios problemas", () => {
    expect(passwordIssues("abc")).toEqual(["TOO_SHORT", "NEEDS_DIGIT"]);
  });
});

describe("assertValidPassword", () => {
  it("no lanza con una contraseña válida", () => {
    expect(() => assertValidPassword("Segura2026")).not.toThrow();
  });

  it("lanza INVALID_PASSWORD (400) con el mensaje de la política", () => {
    try {
      assertValidPassword("corta");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ code: "INVALID_PASSWORD", status: 400 });
      expect((error as AppError).message).toContain("8");
    }
  });
});
