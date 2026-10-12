const STYLES = {
  PENDIENTE: { label: "Pendiente", icon: "○", box: "border-border bg-surface text-foreground" },
  PARCIAL: {
    label: "Pago parcial",
    icon: "◐",
    box: "border-warning bg-warning-subtle text-warning-strong",
  },
  REFINANCIADA: { label: "Refinanciada", icon: "↻", box: "border-border bg-surface text-muted" },
  VENCIDA: {
    label: "Vencida",
    icon: "⚠",
    box: "border-danger bg-danger-subtle text-danger-strong",
  },
  PAGADA: {
    label: "Pagada",
    icon: "✓",
    box: "border-success bg-success-subtle text-success-strong",
  },
  ANULADA: { label: "Anulada", icon: "▣", box: "border-border bg-surface text-muted" },
} as const;

/** Estado de una cuota con ícono y texto (el color nunca es el único portador, frontend-design §6). */
export function InstallmentBadge({
  status,
  daysLate,
  partial = false,
}: {
  status: keyof typeof STYLES;
  daysLate: number;
  /** Vencida con un pago parcial: «Vencida — pago parcial» (02 §2.4), sin un quinto estado. */
  partial?: boolean;
}) {
  const style = STYLES[status];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-sm font-medium ${style.box}`}
    >
      <span aria-hidden="true">{style.icon}</span>
      {style.label}
      {status === "VENCIDA" && partial ? " — pago parcial" : ""}
      {status === "VENCIDA" && daysLate > 0
        ? ` · ${daysLate} ${daysLate === 1 ? "día" : "días"} de mora`
        : ""}
    </span>
  );
}
