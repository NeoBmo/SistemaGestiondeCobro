import type { Metadata } from "next";
import Link from "next/link";
import { getPageSession } from "@/modules/identity/page-session";
import { listTickets } from "@/modules/support/queries";
import { getPool } from "@/shared/database/pg-pool";
import { formatDateTimeInZone } from "@/shared/dates/dates";
import { CreateTicketForm } from "../../_components/ticket-forms";
import { TicketBadges } from "../../_components/ticket-parts";
import { CashFeedbackProvider } from "../_components/cash-feedback";

export const metadata: Metadata = { title: "Soporte" };

export default async function SupportPage() {
  const session = await getPageSession({ roles: ["ADMIN_NEGOCIO"] });
  const tickets = await listTickets(getPool(), session);
  const timeZone = session.businessTimeZone;
  if (!timeZone) throw new Error("El Admin de negocio no tiene zona horaria");

  return (
    <CashFeedbackProvider>
      <Link href="/negocio" className="text-primary text-sm underline">
        ← Negocio
      </Link>
      <h1 className="mt-2 text-2xl font-semibold md:text-3xl">Soporte</h1>
      <p className="text-muted mt-1 text-sm">
        Abre un ticket si algo no funciona; el equipo responde aquí mismo.
      </p>
      <div className="mt-4">
        <CreateTicketForm />
      </div>

      {tickets.length === 0 ? (
        <div className="border-border mt-6 rounded-lg border border-dashed p-6 text-center">
          <p className="font-medium">Todavía no has abierto tickets.</p>
          <p className="text-muted mt-1 text-sm">Cuando necesites ayuda, crea el primero.</p>
        </div>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {tickets.map((ticket) => (
            <li
              key={ticket.id}
              data-testid="ticket"
              className="border-border rounded-lg border p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link
                  href={`/negocio/soporte/${ticket.id}`}
                  className="text-primary font-medium break-words underline"
                >
                  {ticket.description.length > 80
                    ? `${ticket.description.slice(0, 80)}…`
                    : ticket.description}
                </Link>
                <TicketBadges status={ticket.status} priority={ticket.priority} />
              </div>
              <p className="text-muted mt-1 text-sm">
                {formatDateTimeInZone(ticket.createdAt, timeZone)}
                {ticket.hasResponse ? " · Con respuesta" : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </CashFeedbackProvider>
  );
}
