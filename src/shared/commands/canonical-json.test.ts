import { describe, expect, it } from "vitest";
import { canonicalJson, payloadHash } from "./canonical-json";

describe("canonicalJson", () => {
  it("ordena las claves en cualquier nivel y descarta undefined", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: undefined } })).toBe(
      '{"a":{"d":[3,{"x":2,"y":1}]},"b":1}',
    );
  });

  it("distingue valores distintos (importe, texto, null, tipo)", () => {
    const hashes = [
      { amount: 1000 },
      { amount: 1001 },
      { amount: "1000" },
      { amount: null },
      {},
    ].map(payloadHash);
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it("el mismo contenido en otro orden da el mismo hash", () => {
    expect(payloadHash({ a: 1, b: [1, 2] })).toBe(payloadHash({ b: [1, 2], a: 1 }));
    expect(payloadHash({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });
  it("rechaza lo que no se puede canonizar en vez de colapsarlo a un hash igual", () => {
    for (const value of [
      new Date(),
      new Map(),
      new Set(),
      10n,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      () => 1,
    ]) {
      expect(() => canonicalJson({ value }), String(value)).toThrow(TypeError);
    }
  });
});
