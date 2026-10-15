import type { Pool } from "pg";
import { authorizeSession, type SessionContext } from "@/modules/identity/session";
import { AppError } from "@/shared/errors/app-error";
import type { TicketPriority, TicketStatus } from "./validation";

/**
 * Lecturas de tickets (ADR 0011). El Admin solo ve los de su negocio; el Super Admin ve todos. El cobrador
 * no tiene acceso. Los más urgentes primero: abiertos por prioridad y luego por antigüedad.
 */

type Db = Pick<Pool, "query">;

export type TicketListItem = {
  id: string;
  businessId: string;
  businessName: string;
  description: string;
  priority: TicketPriority;
  status: TicketStatus;
  hasResponse: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type TicketListFilter = { status?: TicketStatus; priority?: TicketPriority };

function scope(actor: SessionContext): { businessId: string | null } {
  authorizeSession(actor, { roles: ["ADMIN_NEGOCIO", "SUPER_ADMIN"] });
  if (actor.role === "ADMIN_NEGOCIO") {
    if (!actor.businessId)
      throw new AppError("FORBIDDEN", "No tienes permiso para esta operación", 403);
    return { businessId: actor.businessId };
  }
  return { businessId: null };
}

export async function listTickets(
  db: Db,
  actor: SessionContext,
  filter: TicketListFilter = {},
): Promise<TicketListItem[]> {
  const { businessId } = scope(actor);
  const { rows } = await db.query<{
    id: string;
    business_id: string;
    business_name: string;
    description: string;
    priority: TicketPriority;
    status: TicketStatus;
    response: string | null;
    created_at: Date;
    updated_at: Date;
  }>(
    `select t.id, t.business_id, b.name as business_name, t.description, t.priority, t.status, t.response,
            t.created_at, t.updated_at
       from public.support_tickets t join public.businesses b on b.id = t.business_id
      where ($1::uuid is null or t.business_id = $1)
        and ($2::text is null or t.status = $2)
        and ($3::text is null or t.priority = $3)
      order by (t.status = 'CERRADO'),
               case t.priority when 'ALTA' then 0 when 'MEDIA' then 1 else 2 end,
               t.created_at, t.id
      limit 100`,
    [businessId, filter.status ?? null, filter.priority ?? null],
  );
  return rows.map((row) => ({
    id: row.id,
    businessId: row.business_id,
    businessName: row.business_name,
    description: row.description,
    priority: row.priority,
    status: row.status,
    hasResponse: row.response !== null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export type TicketEventView = {
  id: string;
  kind: "CREADO" | "ESTADO" | "PRIORIDAD" | "RESPUESTA";
  from: string | null;
  to: string | null;
  actorName: string;
  actorRole: string;
  createdAt: Date;
};

export type TicketDetail = TicketListItem & {
  response: string | null;
  createdByName: string;
  events: TicketEventView[];
};

export async function getTicket(
  db: Db,
  actor: SessionContext,
  ticketId: string,
): Promise<TicketDetail | null> {
  const { businessId } = scope(actor);
  const found = await db.query<{
    id: string;
    business_id: string;
    business_name: string;
    description: string;
    priority: TicketPriority;
    status: TicketStatus;
    response: string | null;
    created_by_name: string;
    created_at: Date;
    updated_at: Date;
  }>(
    `select t.id, t.business_id, b.name as business_name, t.description, t.priority, t.status, t.response,
            u.display_name as created_by_name, t.created_at, t.updated_at
       from public.support_tickets t
       join public.businesses b on b.id = t.business_id
       join public.profiles u on u.id = t.created_by
      where t.id = $1 and ($2::uuid is null or t.business_id = $2)`,
    [ticketId, businessId],
  );
  const row = found.rows[0];
  if (!row) return null;
  const events = await db.query<{
    id: string;
    kind: TicketEventView["kind"];
    from_value: string | null;
    to_value: string | null;
    actor_name: string;
    actor_role: string;
    created_at: Date;
  }>(
    `select e.id, e.kind, e.from_value, e.to_value, p.display_name as actor_name, p.role as actor_role, e.created_at
       from public.support_ticket_events e join public.profiles p on p.id = e.actor_id
      where e.ticket_id = $1 order by e.seq`,
    [ticketId],
  );
  return {
    id: row.id,
    businessId: row.business_id,
    businessName: row.business_name,
    description: row.description,
    priority: row.priority,
    status: row.status,
    hasResponse: row.response !== null,
    response: row.response,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    events: events.rows.map((event) => ({
      id: event.id,
      kind: event.kind,
      from: event.from_value,
      to: event.to_value,
      actorName: event.actor_name,
      actorRole: event.actor_role,
      createdAt: event.created_at,
    })),
  };
}

export type OpenTicketCounts = Record<TicketPriority, number>;

/** Tickets sin cerrar por prioridad, para el panel del Super Admin. */
export async function countOpenTickets(db: Db, actor: SessionContext): Promise<OpenTicketCounts> {
  authorizeSession(actor, { roles: ["SUPER_ADMIN"] });
  const { rows } = await db.query<{ priority: TicketPriority; n: string }>(
    `select priority, count(*)::text as n from public.support_tickets
      where status <> 'CERRADO' group by priority`,
  );
  const counts: OpenTicketCounts = { ALTA: 0, MEDIA: 0, BAJA: 0 };
  for (const row of rows) counts[row.priority] = Number(row.n);
  return counts;
}
