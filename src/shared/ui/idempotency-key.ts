/**
 * UUID v4 para la clave de idempotencia. `crypto.randomUUID` solo existe en contextos seguros (HTTPS o
 * localhost): probando en un móvil por HTTP de la red local no está, y sin esto el envío fallaba sin aviso.
 */
export function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Clave por intento del usuario (03 §3): `current()` devuelve siempre la misma hasta que se llama a
 * `renew()`, de modo que reintentar el mismo envío (un corte de red) no duplica el dinero.
 */
export function createIdempotencyKeyHolder(generate: () => string = newIdempotencyKey) {
  let key: string | null = null;
  return {
    current: () => (key ??= generate()),
    renew: () => {
      key = null;
    },
  };
}
