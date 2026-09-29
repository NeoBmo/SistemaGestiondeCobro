import { describe, expect, it } from "vitest";
import {
  buildSyntheticEmail as scriptBuildSyntheticEmail,
  isValidUsername as scriptIsValidUsername,
  normalizeUsername as scriptNormalizeUsername,
  passwordIssues as scriptPasswordIssues,
} from "../../../scripts/create-super-admin.mjs";
import { passwordIssues } from "@/modules/identity/password-policy";
import { syntheticEmail } from "@/modules/identity/synthetic-email";
import { isValidUsername, normalizeUsername } from "@/modules/identity/username";

// El script de arranque no importa del código de la aplicación (se ejecuta con Node puro): estas
// pruebas fallan si sus reglas se desvían de las de la aplicación.

describe("create-super-admin.mjs sigue las mismas reglas que la aplicación", () => {
  const usernames = [
    "abc",
    "ab",
    "juan.perez",
    "Juan",
    "con espacio",
    "a@b",
    "ñandú",
    "x".repeat(32),
    "x".repeat(33),
    "",
    "cobrador_1-a",
  ];
  const passwords = [
    "",
    "abc123",
    "abcdefg1",
    "12345678",
    "abcdefgh",
    "contraseña1",
    "x".repeat(71) + "1",
    "a1" + "x".repeat(71),
    "ñ".repeat(40) + "1",
    "Clave2026x",
  ];

  it("validación de usuario", () => {
    for (const username of usernames) {
      expect(scriptIsValidUsername(username), JSON.stringify(username)).toBe(
        isValidUsername(username),
      );
    }
  });

  it("normalización de usuario (mayúsculas y espacios, como se teclea en el celular)", () => {
    for (const username of ["  Juan.Perez ", "COBRADOR_1-A", "abc"]) {
      expect(scriptNormalizeUsername(username), username).toBe(normalizeUsername(username));
    }
  });

  it("construcción del email sintético (usuario y dominio normalizados)", () => {
    const cases: [string, string][] = [
      ["Root.Admin", "cuadre.invalid"],
      ["  root ", " Cuadre.Invalid "],
    ];
    for (const [username, domain] of cases) {
      expect(scriptBuildSyntheticEmail(username, domain), `${username}@${domain}`).toBe(
        syntheticEmail(username, domain),
      );
    }
  });

  it("política de contraseñas", () => {
    for (const password of passwords) {
      expect(scriptPasswordIssues(password), JSON.stringify(password)).toEqual(
        passwordIssues(password),
      );
    }
  });
});
