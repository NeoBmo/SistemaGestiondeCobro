import type { Metadata } from "next";
import Link from "next/link";
import { getPageSession } from "@/modules/identity/page-session";
import { listTickets } from "@/modules/support/queries";
import {
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  ticketListFilterSchema,
} from "@/modules/support/validation";
import { DEFAULT_TIME_ZONE } from "@/modules/subscriptions/create-business";
import { getPool } from "@/shared/database/pg-pool";
import { formatDateTimeInZone } from "@/shared/dates/dates";
import { PRIORITY_LABEL, STATUS_LABEL, TicketBadges } from "../../_components/ticket-parts";

export const metadata: Metadata = { title: "Soporte" };

const controlClass = "border-border-strong bg-surface min-h-11 rounded-lg border px-3 font-normal";

export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getPageSession({ roles: ["SUPER_ADMIN"] });
  const raw = await searchParams;
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  // Un valor inválido se ignora en vez de romper la pantalla.
  const parsed = ticketListFilterSchema.safeParse({
    status: first(raw.estado) || undefined,
    priority: first(raw.prioridad) || undefined,
  });
  const filter = parsed.success ? parsed.data : {};
  const tickets = await listTickets(getPool(), session, filter);
  const filtered = Boolean(filter.status || filter.priority);

  return (
    <>
      <h1 className="text-2xl font-semibold md:text-3xl">Soporte</h1>
      <form method="get" aria-label="Filtrar tickets" className="mt-4 grid gap-3 md:grid-cols-3">
        <label className="flex flex-col gap-1 text-base font-medium">
          Estado
          <select name="estado" defaultValue={filter.status ?? ""} className={controlClass}>
            <option value="">Todos</option>
            {TICKET_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABEL[status].label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-base font-medium">
          Prioridad
          <select name="prioridad" defaultValue={filter.priority ?? ""} className={controlClass}>
            <option value="">Todas</option>
            {TICKET_PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {PRIORITY_LABEL[priority].label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end gap-3">
          <button
            type="submit"
            className="border-border-strong bg-surface hover:bg-surface-2 inline-flex min-h-11 items-center rounded-lg border px-4 font-medium"
          >
            Filtrar
          </button>
          {filtered ? (
            <Link
              href="/super-admin/soporte"
              className="text-primary min-h-11 content-center underline"
            >
              Quitar filtros
            </Link>
          ) : null}
        </div>
      </form>

      <p className="text-muted mt-4 text-sm" role="status">
        {tickets.length === 1 ? "1 ticket" : `${tickets.length} tickets`}
      </p>
      {tickets.length === 0 ? (
        <div className="border-border mt-3 rounded-lg border border-dashed p-6 text-center">
          <p className="font-medium">No hay tickets{filtered ? " con estos filtros" : ""}.</p>
          {filtered ? (
            <Link href="/super-admin/soporte" className="text-primary mt-2 inline-block underline">
              Quitar filtros
            </Link>
          ) : null}
        </div>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {tickets.map((ticket) => (
            <li
              key={ticket.id}
              data-testid="ticket"
              className="border-border rounded-lg border p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link
                  href={`/super-admin/soporte/${ticket.id}`}
                  className="text-primary font-medium underline"
                >
                  {ticket.businessName}
                </Link>
                <TicketBadges status={ticket.status} priority={ticket.priority} />
              </div>
              <p className="mt-1 text-sm break-words">
                {ticket.description.length > 120
                  ? `${ticket.description.slice(0, 120)}…`
                  : ticket.description}
              </p>
              <p className="text-muted text-sm">
                {formatDateTimeInZone(ticket.createdAt, DEFAULT_TIME_ZONE)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
