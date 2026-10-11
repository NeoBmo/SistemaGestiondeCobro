import { AppError } from "@/shared/errors/app-error";
import type { Tx } from "./with-transaction";

/**
 * Tiempo máximo que una transacción espera un bloqueo de fila. Sin tope, los comandos que mantienen un
 * bloqueo mientras llaman a Auth (restablecer la contraseña, cambio obligatorio) podrían dejar a otros
 * esperando con su conexión del pool ocupada hasta agotarlo.
 */
export const LOCK_TIMEOUT_MS = 5000;

/** Aplica el tope solo a la transacción en curso (`set local`). Llamar justo después de abrirla. */
export async function setLockTimeout(tx: Tx): Promise<void> {
  await tx.query(`set local lock_timeout = ${LOCK_TIMEOUT_MS}`);
}

/** `55P03` (lock_not_available) → un 409 que invita a reintentar; cualquier otro error pasa intacto. */
export function translateLockTimeout(error: unknown): unknown {
  if ((error as { code?: string } | null)?.code === "55P03") {
    return new AppError(
      "OPERATION_IN_PROGRESS",
      "Hay otra operación en curso sobre esta cuenta. Intenta de nuevo en unos segundos",
      409,
    );
  }
  return error;
}
