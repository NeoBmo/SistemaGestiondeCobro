import { STATUS_PRESENTATION, type StatusTone } from "@/modules/subscriptions/status-presentation";
import type { SubscriptionStatus } from "@/modules/subscriptions/subscription-status";

const TONES: Record<StatusTone, string> = {
  success: "border-success bg-success-subtle text-success-strong",
  warning: "border-warning bg-warning-subtle text-warning-strong",
  danger: "border-danger bg-danger-subtle text-danger-strong",
  neutral: "border-border bg-surface text-foreground",
};

/** Estado con ícono y texto: el color refuerza, nunca es el único portador de significado. */
export function StatusBadge({ status }: { status: SubscriptionStatus }) {
  const { label, icon, tone } = STATUS_PRESENTATION[status];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-sm font-medium ${TONES[tone]}`}
    >
      <span aria-hidden="true">{icon}</span>
      {label}
    </span>
  );
}
