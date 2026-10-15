import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPageSession } from "@/modules/identity/page-session";
import { DEFAULT_TIME_ZONE } from "@/modules/subscriptions/create-business";
import { getTicket } from "@/modules/support/queries";
import { getPool } from "@/shared/database/pg-pool";
import { formatDateTimeInZone } from "@/shared/dates/dates";
import { CashFeedbackProvider } from "../../../negocio/_components/cash-feedback";
import { AttendTicketForm } from "../../../_components/ticket-forms";
import { TicketBadges, TicketHistory } from "../../../_components/ticket-parts";

export const metadata: Metadata = { title: "Ticket" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function TicketPage({ params }: { params: Promise<{ ticketId: string }> }) {
  const session = await getPageSession({ roles: ["SUPER_ADMIN"] });
  const { ticketId } = await params;
  if (!UUID.test(ticketId)) notFound();
  const ticket = await getTicket(getPool(), session, ticketId);
  if (!ticket) notFound();

  return (
    <CashFeedbackProvider>
      <Link href="/super-admin/soporte" className="text-primary text-sm underline">
        ← Soporte
      </Link>
      <h1 className="mt-2 text-2xl font-semibold md:text-3xl">{ticket.businessName}</h1>
      <div className="mt-2">
        <TicketBadges status={ticket.status} priority={ticket.priority} />
      </div>
      <p className="mt-3 break-words whitespace-pre-line">{ticket.description}</p>
      <p className="text-muted text-sm">
        {ticket.createdByName} · {formatDateTimeInZone(ticket.createdAt, DEFAULT_TIME_ZONE)}
      </p>

      <section aria-labelledby="atender" className="mt-6">
        <h2 id="atender" className="text-xl font-semibold">
          Atención
        </h2>
        <div className="mt-3">
          <AttendTicketForm
            ticketId={ticket.id}
            status={ticket.status}
            priority={ticket.priority}
            response={ticket.response}
          />
        </div>
      </section>

      <section aria-labelledby="historial" className="mt-6">
        <h2 id="historial" className="text-xl font-semibold">
          Historial
        </h2>
        <TicketHistory events={ticket.events} timeZone={DEFAULT_TIME_ZONE} />
      </section>
    </CashFeedbackProvider>
  );
}
