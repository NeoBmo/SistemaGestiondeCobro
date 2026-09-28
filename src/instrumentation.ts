/** Falla al arrancar el servidor (no en la primera petición) si falta o es inválida una variable de entorno. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getPublicEnv, getServerEnv } = await import("@/shared/validation/env");
    getPublicEnv();
    getServerEnv();
  }
}
