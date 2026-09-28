import { describe, expect, it } from "vitest";
import { AppError } from "../errors/app-error";
import { isIdempotencyKey, parseIdempotencyKey } from "./idempotency-key";

const VALID = "3f2b8c1e-9a4d-4b6f-8e2a-1c7d5f0a9b34";

describe("idempotency key", () => {
  it("acepta un UUID (mayúsculas o minúsculas) y lo normaliza a minúsculas", () => {
    expect(isIdempotencyKey(VALID)).toBe(true);
    expect(parseIdempotencyKey(VALID.toUpperCase())).toBe(VALID);
  });

  it("rechaza valores que no son UUID", () => {
    const invalid = ["", "abc", "3f2b8c1e-9a4d-4b6f-8e2a-1c7d5f0a9b3", `${VALID}0`, `x${VALID}`];
    for (const bad of invalid) {
      expect(isIdempotencyKey(bad)).toBe(false);
    }
  });

  it("rechaza tipos no string", () => {
    for (const bad of [undefined, null, 42, {}, []]) {
      expect(isIdempotencyKey(bad)).toBe(false);
    }
  });

  it("parseIdempotencyKey lanza AppError 400 INVALID_IDEMPOTENCY_KEY", () => {
    try {
      parseIdempotencyKey("no-es-uuid");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ code: "INVALID_IDEMPOTENCY_KEY", status: 400 });
    }
  });
});
