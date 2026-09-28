import { describe, expect, it } from "vitest";

describe("entorno de pruebas", () => {
  it("ejecuta Vitest con el alias @", () => {
    expect(1 + 1).toBe(2);
  });
});
