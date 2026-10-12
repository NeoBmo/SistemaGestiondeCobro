import { describe, expect, it } from "vitest";
import { isIdempotencyKey } from "@/shared/ids/idempotency-key";
import { createIdempotencyKeyHolder, newIdempotencyKey } from "./idempotency-key";

describe("clave de idempotencia del cliente", () => {
  it("se mantiene al reintentar y cambia solo al renovarla", () => {
    let n = 0;
    const holder = createIdempotencyKeyHolder(() => `clave-${(n += 1)}`);

    expect(holder.current()).toBe("clave-1");
    expect(holder.current()).toBe("clave-1");
    holder.renew();
    expect(holder.current()).toBe("clave-2");
  });

  it("genera UUID v4 válidos para el servidor, también sin crypto.randomUUID (contexto no seguro)", () => {
    expect(isIdempotencyKey(newIdempotencyKey())).toBe(true);

    const original = crypto.randomUUID;
    Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });
    try {
      const keys = new Set(Array.from({ length: 20 }, newIdempotencyKey));
      expect(keys.size).toBe(20);
      for (const key of keys) expect(isIdempotencyKey(key), key).toBe(true);
    } finally {
      Object.defineProperty(crypto, "randomUUID", { value: original, configurable: true });
    }
  });
});
