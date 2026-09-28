import { describe, expect, it } from "vitest";
import { AppError } from "@/shared/errors/app-error";
import { syntheticEmail } from "./synthetic-email";

// ADR 0002: el usuario se mapea a un email sintético para Supabase Auth; no se envían correos.

describe("syntheticEmail", () => {
  it("une usuario normalizado y dominio configurado", () => {
    expect(syntheticEmail("Juan.Perez", "cuadre.invalid")).toBe("juan.perez@cuadre.invalid");
  });

  it("normaliza también el dominio", () => {
    expect(syntheticEmail("juan", " Cuadre.Invalid ")).toBe("juan@cuadre.invalid");
  });

  it("rechaza un usuario inválido antes de construir el email", () => {
    expect(() => syntheticEmail("no válido", "cuadre.invalid")).toThrow(AppError);
  });
});
