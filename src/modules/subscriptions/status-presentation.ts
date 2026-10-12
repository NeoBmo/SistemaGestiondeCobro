import type { SubscriptionStatus } from "./subscription-status";

export type StatusTone = "success" | "warning" | "danger" | "neutral";

/** Texto, ícono y tono de cada estado: el color nunca va solo (frontend-design §6). */
export const STATUS_PRESENTATION: Record<
  SubscriptionStatus,
  { label: string; icon: string; tone: StatusTone }
> = {
  ACTIVA: { label: "Activa", icon: "✓", tone: "success" },
  PROXIMA_A_VENCER: { label: "Próxima a vencer", icon: "!", tone: "warning" },
  VENCIDA: { label: "Vencida", icon: "⚠", tone: "danger" },
  SUSPENDIDA: { label: "Suspendida", icon: "‖", tone: "warning" },
  ARCHIVADA: { label: "Archivada", icon: "▣", tone: "neutral" },
};

export const ACCESS_LABEL = { ACTIVO: "Acceso activo", SUSPENDIDO: "Acceso suspendido" } as const;
