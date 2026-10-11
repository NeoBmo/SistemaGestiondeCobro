import { AppError } from "@/shared/errors/app-error";
import type { StoredSubscriptionStatus } from "./subscription-status";

/** Comandos del ciclo de vida de un negocio; solo el Super Admin los ejecuta (02-DOMINIO §1.2–1.3, ADR 0005). */
export type LifecycleCommand = "SUSPEND" | "ACTIVATE" | "ARCHIVE" | "CHANGE_PLAN" | "RESUBSCRIBE";

type CurrentStatus = StoredSubscriptionStatus | null;

/** Estados de la suscripción **vigente** (no archivada) desde los que cada comando es válido. */
const ALLOWED_FROM: Record<LifecycleCommand, readonly CurrentStatus[]> = {
  SUSPEND: ["ACTIVA"],
  ACTIVATE: ["SUSPENDIDA"],
  ARCHIVE: ["ACTIVA", "SUSPENDIDA"],
  CHANGE_PLAN: ["ACTIVA", "SUSPENDIDA"],
  // Sin suscripción vigente: el negocio fue archivado y vuelve con una suscripción nueva.
  RESUBSCRIBE: [null],
};

const LABEL: Record<LifecycleCommand, string> = {
  SUSPEND: "suspender el negocio",
  ACTIVATE: "activar el negocio",
  ARCHIVE: "archivar el negocio",
  CHANGE_PLAN: "cambiar el plan del negocio",
  RESUBSCRIBE: "re-suscribir el negocio",
};

/**
 * `current` es el estado de la suscripción vigente del negocio, o `null` si no tiene ninguna (todas
 * archivadas). Lanza `INVALID_STATE_TRANSITION` (409) si el comando no aplica desde ese estado.
 */
export function assertTransition(command: LifecycleCommand, current: CurrentStatus): void {
  if (ALLOWED_FROM[command].includes(current)) return;

  const hint =
    current === null
      ? "El negocio está archivado: solo puede volver por re-suscripción (una suscripción nueva)."
      : `La suscripción está ${current}.`;
  throw new AppError(
    "INVALID_STATE_TRANSITION",
    `No se puede ${LABEL[command]} en su estado actual. ${hint}`,
    409,
  );
}
