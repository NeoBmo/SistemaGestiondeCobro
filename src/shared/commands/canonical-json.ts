import { createHash } from "node:crypto";

/**
 * JSON con las claves ordenadas y sin `undefined`: dos entradas equivalentes producen el mismo texto,
 * así que el mismo comando reenviado da el mismo hash aunque el cliente reordene los campos. Un número y su
 * texto (`100` y `"100"`) son contenidos distintos (409 si se reutiliza la clave). Solo admite primitivos,
 * arreglos y objetos planos: fechas, mapas, `bigint` o números no finitos lanzan, en vez de colapsar a un hash igual.
 */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null) return "null";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("canonicalJson: número no finito");
    return JSON.stringify(value);
  }
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value !== "object")
    throw new TypeError(`canonicalJson: tipo no admitido (${typeof value})`);
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  ) {
    // Date, Map, Set…: `Object.entries` los vería vacíos y todos darían el mismo hash.
    throw new TypeError("canonicalJson: solo objetos planos, arreglos y primitivos");
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`);
  return `{${entries.join(",")}}`;
}

/** SHA-256 hexadecimal de la forma canónica: lo que se guarda en `idempotency_keys.payload_hash`. */
export function payloadHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
