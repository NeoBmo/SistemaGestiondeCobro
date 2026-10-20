import { formatDateTimeInZone } from "@/shared/dates/dates";
import type { TicketEventView } from "@/modules/support/queries";
import type { TicketPriority, TicketStatus } from "@/modules/support/validation";

export const STATUS_LABEL: Record<TicketStatus, { icon: string; label: string }> = {
  ABIERTO: { icon: "●", label: "Abierto" },
  EN_ATENCION: { icon: "◐", label: "En atención" },
  RESUELTO: { icon: "✓", label: "Resuelto" },
  CERRADO: { icon: "▣", label: "Cerrado" },
};

export const PRIORITY_LABEL: Record<TicketPriority, { icon: string; label: string }> = {
  ALTA: { icon: "▲", label: "Prioridad alta" },
  MEDIA: { icon: "■", label: "Prioridad media" },
  BAJA: { icon: "▽", label: "Prioridad baja" },
};

/** Estado y prioridad con ícono y texto: el color nunca es el único portador de significado. */
export function TicketBadges({
  status,
  priority,
}: {
  status: TicketStatus;
  priority: TicketPriority;
}) {
  const box =
    "border-border bg-surface inline-flex items-center gap-1 rounded-sm border px-2 py-1 text-xs font-medium";
  return (
    <span className="flex flex-wrap gap-2">
      <span className={box}>
        <span aria-hidden="true">{STATUS_LABEL[status].icon}</span>
        {STATUS_LABEL[status].label}
      </span>
      <span className={box}>
        <span aria-hidden="true">{PRIORITY_LABEL[priority].icon}</span>
        {PRIORITY_LABEL[priority].label}
      </span>
    </span>
  );
}

function describe(event: TicketEventView): string {
  switch (event.kind) {
    case "CREADO":
      return `Ticket creado con prioridad ${event.to?.toLowerCase() ?? ""}`;
    case "ESTADO":
      return `Estado: ${event.from ? STATUS_LABEL[event.from as TicketStatus].label : "—"} → ${
        event.to ? STATUS_LABEL[event.to as TicketStatus].label : "—"
      }`;
    case "PRIORIDAD":
      return `Prioridad: ${event.from?.toLowerCase()} → ${event.to?.toLowerCase()}`;
    case "RESPUESTA":
      return `Respuesta: ${event.to}`;
  }
}

/** Historial del ticket en orden: nada se borra, cada cambio queda con quién y cuándo. */
export function TicketHistory({
  events,
  timeZone,
}: {
  events: TicketEventView[];
  timeZone: string;
}) {
  return (
    <ol
      className="mt-3 flex flex-col gap-2"
      aria-label="Historial del ticket"
      data-testid="historial"
    >
      {events.map((event) => (
        <li key={event.id} className="border-border rounded-lg border p-3 text-sm">
          <p className="break-words whitespace-pre-line">{describe(event)}</p>
          <p className="text-muted">
            {event.actorName} · {event.actorRole === "SUPER_ADMIN" ? "Soporte" : "Administrador"} ·{" "}
            {formatDateTimeInZone(event.createdAt, timeZone)}
          </p>
        </li>
      ))}
    </ol>
  );
}
