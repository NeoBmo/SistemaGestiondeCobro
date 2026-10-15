import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPageSession } from "@/modules/identity/page-session";
import { getTicket } from "@/modules/support/queries";
import { getPool } from "@/shared/database/pg-pool";
import { formatDateTimeInZone } from "@/shared/dates/dates";
import { ResolvedTicketActions } from "../../../_components/ticket-forms";
import { TicketBadges, TicketHistory } from "../../../_components/ticket-parts";
import { CashFeedbackProvider } from "../../_components/cash-feedback";

export const metadata: Metadata = { title: "Ticket" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function TicketPage({ params }: { params: Promise<{ ticketId: string }> }) {
  const session = await getPageSession({ roles: ["ADMIN_NEGOCIO"] });
  const { ticketId } = await params;
  if (!UUID.test(ticketId)) notFound();
  const ticket = await getTicket(getPool(), session, ticketId);
  if (!ticket) notFound();
  const timeZone = session.businessTimeZone;
  if (!timeZone) throw new Error("El Admin de negocio no tiene zona horaria");

  return (
    <CashFeedbackProvider>
      <Link href="/negocio/soporte" className="text-primary text-sm underline">
        ← Soporte
      </Link>
      <h1 className="mt-2 text-2xl font-semibold md:text-3xl">Ticket</h1>
      <div className="mt-2">
        <TicketBadges status={ticket.status} priority={ticket.priority} />
      </div>
      <p className="mt-3 break-words whitespace-pre-line">{ticket.description}</p>
      <p className="text-muted text-sm">
        Abierto el {formatDateTimeInZone(ticket.createdAt, timeZone)} por {ticket.createdByName}
      </p>

      <section aria-labelledby="respuesta" className="border-border mt-6 rounded-lg border p-4">
        <h2 id="respuesta" className="text-xl font-semibold">
          Respuesta de soporte
        </h2>
        {ticket.response ? (
          <p className="mt-2 break-words whitespace-pre-line" data-testid="respuesta">
            {ticket.response}
          </p>
        ) : (
          <p className="text-muted mt-2 text-sm">Todavía no hay respuesta.</p>
        )}
        {ticket.status === "RESUELTO" ? (
          <div className="mt-3">
            <ResolvedTicketActions ticketId={ticket.id} />
          </div>
        ) : null}
      </section>

      <section aria-labelledby="historial" className="mt-6">
        <h2 id="historial" className="text-xl font-semibold">
          Historial
        </h2>
        <TicketHistory events={ticket.events} timeZone={timeZone} />
      </section>
    </CashFeedbackProvider>
  );
}
