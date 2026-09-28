import { describe, expect, it } from "vitest";
import { AppError, isAppError } from "./app-error";

describe("AppError", () => {
  it("conserva code, message y status", () => {
    const error = new AppError("NOT_FOUND", "No existe el recurso", 404);

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("NOT_FOUND");
    expect(error.message).toBe("No existe el recurso");
    expect(error.status).toBe(404);
    expect(error.name).toBe("AppError");
  });

  it("usa status 400 por defecto", () => {
    expect(new AppError("INVALID", "Dato inválido").status).toBe(400);
  });

  it("isAppError distingue AppError de otros errores", () => {
    expect(isAppError(new AppError("X", "x"))).toBe(true);
    expect(isAppError(new Error("x"))).toBe(false);
    expect(isAppError({ code: "X", message: "x", status: 400 })).toBe(false);
  });
});
