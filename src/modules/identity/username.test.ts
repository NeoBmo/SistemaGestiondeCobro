import { describe, expect, it } from "vitest";
import { AppError } from "@/shared/errors/app-error";
import { isValidUsername, normalizeUsername, parseUsername } from "./username";

// ADR 0002 y 02-DOMINIO §1.4: usuario único global, minúsculas, mismo formato que el CHECK de la BD.

describe("normalizeUsername", () => {
  it("recorta espacios y pasa a minúsculas (así lo teclean en el celular)", () => {
    expect(normalizeUsername("  Juan.Perez ")).toBe("juan.perez");
  });
});

describe("isValidUsername", () => {
  it("acepta minúsculas, dígitos, punto, guion y guion bajo de 3 a 32 caracteres", () => {
    for (const good of ["abc", "juan.perez", "juan_perez-2", "x".repeat(32)]) {
      expect(isValidUsername(good), good).toBe(true);
    }
  });

  it("rechaza mayúsculas, espacios, símbolos, acentos y longitudes fuera de rango", () => {
    for (const bad of ["Juan", "ab", "con espacio", "a@b", "ñandú", "x".repeat(33), ""]) {
      expect(isValidUsername(bad), bad).toBe(false);
    }
  });
});

describe("parseUsername", () => {
  it("normaliza y devuelve un usuario válido", () => {
    expect(parseUsername("  Cobrador.Uno ")).toBe("cobrador.uno");
  });

  it("lanza INVALID_USERNAME (400) si no es válido", () => {
    try {
      parseUsername("no válido");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ code: "INVALID_USERNAME", status: 400 });
    }
  });
});
