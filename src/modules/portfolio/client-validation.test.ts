import { describe, expect, it } from "vitest";
import { createClientSchema, updateClientSchema } from "./client-validation";

describe("validación de clientes", () => {
  it("recorta los textos, trata lo vacío como sin dato y exige nombre e identificación", () => {
    expect(
      createClientSchema.parse({
        name: "  Ana Pérez ",
        identification: " 123 ",
        nickname: "  ",
        phone: " 300 ",
      }),
    ).toEqual({ name: "Ana Pérez", identification: "123", phone: "300" });

    for (const input of [
      { identification: "1" },
      { name: "  ", identification: "1" },
      { name: "Ana" },
      { name: "Ana", identification: "   " },
    ]) {
      expect(createClientSchema.safeParse(input).success, JSON.stringify(input)).toBe(false);
    }
  });

  it("la identificación necesita al menos una letra o un dígito (la unicidad compara solo esos)", () => {
    for (const identification of ["ABC-1", "ñ", "7", "Ñandú 1"]) {
      expect(
        createClientSchema.safeParse({ name: "Ana", identification }).success,
        identification,
      ).toBe(true);
    }
    for (const identification of ["-", "--/..", "#"]) {
      expect(
        createClientSchema.safeParse({ name: "Ana", identification }).success,
        identification,
      ).toBe(false);
    }
  });

  it("respeta los largos máximos y rechaza el byte nulo", () => {
    const base = { name: "Ana", identification: "1" };
    expect(createClientSchema.safeParse({ ...base, name: "x".repeat(121) }).success).toBe(false);
    expect(createClientSchema.safeParse({ ...base, identification: "x".repeat(41) }).success).toBe(
      false,
    );
    expect(createClientSchema.safeParse({ ...base, notes: "x".repeat(1001) }).success).toBe(false);
    expect(createClientSchema.safeParse({ ...base, notes: "x".repeat(1000) }).success).toBe(true);
    expect(createClientSchema.safeParse({ ...base, address: "a\0b" }).success).toBe(false);
  });

  it("la edición no acepta identificación ni negocio: se descartan", () => {
    const parsed = updateClientSchema.parse({
      name: "Ana",
      identification: "999",
      businessId: "otro",
    });
    expect(parsed).toEqual({ name: "Ana" });
  });
});
