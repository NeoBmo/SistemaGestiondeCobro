import type { Pool } from "pg";
import { recordAuditEvent } from "@/modules/audit/record-audit-event";
import { authorizeBusinessAdmin } from "@/modules/identity/authorize-business-admin";
import { authorizeSuperAdminOnBusiness } from "@/modules/identity/authorize-super-admin";
import { authorizeSession, type SessionContext } from "@/modules/identity/session";
import { setLockTimeout, translateLockTimeout } from "@/shared/database/lock-timeout";
import { withTransaction, type Tx } from "@/shared/database/with-transaction";
import { AppError } from "@/shared/errors/app-error";
import type {
  AttendTicketInput,
  CreateTicketInput,
  TicketPriority,
  TicketStatus,
} from "./validation";

/**
 * Tickets de soporte (02 §6.2, ADR 0011). Comandos de administración: una transacción y su auditoría, sin
 * dinero ni clave de idempotencia. El Admin crea, cierra o reabre los de su negocio; el Super Admin atiende
 * (estado hacia adelante, prioridad y respuesta). Cada cambio deja su evento de solo agregado: la base lo
 * exige (un cambio sin evento no se confirma).
 */

export type TicketDeps = { db: Pick<Pool, "connect" | "query"> };

type TicketRow = {
  id: string;
  business_id: string;
  status: TicketStatus;
  priority: TicketPriority;
  response: string | null;
};

async function addEvent(
  tx: Tx,
  ticket: { id: string; business_id: string },
  actorId: string,
  kind: "CREADO" | "ESTADO" | "PRIORIDAD" | "RESPUESTA",
  from: string | null,
  to: string | null,
) {
  await tx.query(
    `insert into public.support_ticket_events (business_id, ticket_id, actor_id, kind, from_value, to_value)
     values ($1, $2, $3, $4, $5, $6)`,
    [ticket.business_id, ticket.id, actorId, kind, from, to],
  );
}

export type CreatedTicket = { ticketId: string; priority: TicketPriority };

export async function createTicket(
  deps: TicketDeps,
  actor: SessionContext,
  input: CreateTicketInput,
): Promise<CreatedTicket> {
  const businessId = await authorizeBusinessAdmin(deps.db, actor, "TicketCreado");
  return withTransaction(async (tx) => {
    const created = await tx.query<{ id: string }>(
      `insert into public.support_tickets (business_id, created_by, description, priority)
       values ($1, $2, $3, $4) returning id`,
      [businessId, actor.userId, input.description, input.priority],
    );
    const ticketId = created.rows[0]!.id;
    await addEvent(
      tx,
      { id: ticketId, business_id: businessId },
      actor.userId,
      "CREADO",
      null,
      input.priority,
    );
    await recordAuditEvent(tx, {
      businessId,
      actorId: actor.userId,
      action: "TicketCreado",
      entityType: "support_ticket",
      entityId: ticketId,
      summary: { priority: input.priority },
    });
    return { ticketId, priority: input.priority };
  }, deps.db);
}

export type AttendedTicket = {
  ticketId: string;
  changed: ("status" | "priority" | "response")[];
  status: TicketStatus;
  priority: TicketPriority;
};

const FORWARD: Record<TicketStatus, TicketStatus[]> = {
  ABIERTO: ["EN_ATENCION", "RESUELTO"],
  EN_ATENCION: ["RESUELTO"],
  RESUELTO: [],
  CERRADO: [],
};

async function lockTicket(tx: Tx, ticketId: string, businessId?: string): Promise<TicketRow> {
  const { rows } = await tx.query<TicketRow>(
    `select id, business_id, status, priority, response from public.support_tickets
      where id = $1 and ($2::uuid is null or business_id = $2) for update`,
    [ticketId, businessId ?? null],
  );
  if (!rows[0]) throw new AppError("TICKET_NOT_FOUND", "El ticket no existe", 404);
  return rows[0];
}

/** El Super Admin atiende un ticket: solo lo que cambia deja evento; si no cambia nada, no se escribe. */
export async function attendTicket(
  deps: TicketDeps,
  actor: SessionContext,
  ticketId: string,
  input: AttendTicketInput,
): Promise<AttendedTicket> {
  // La autorización se evalúa sobre el negocio del ticket para auditar un rechazo; un ticket que no
  // existe da el mismo 403 a quien no es Super Admin (no se revela qué tickets hay).
  const owner = await deps.db.query<{ business_id: string }>(
    "select business_id from public.support_tickets where id = $1",
    [ticketId],
  );
  const businessId = owner.rows[0]?.business_id;
  if (!businessId) {
    authorizeSession(actor, { roles: ["SUPER_ADMIN"] });
    throw new AppError("TICKET_NOT_FOUND", "El ticket no existe", 404);
  }
  await authorizeSuperAdminOnBusiness(deps.db, actor, "TicketAtendido", businessId);

  try {
    return await withTransaction(async (tx) => {
      await setLockTimeout(tx);
      const ticket = await lockTicket(tx, ticketId);
      if (ticket.status === "CERRADO") {
        throw new AppError("TICKET_CLOSED", "El ticket está cerrado: ya no se modifica", 409);
      }
      const changed: AttendedTicket["changed"] = [];
      const audit = { businessId: ticket.business_id, actorId: actor.userId };
      const entity = { entityType: "support_ticket", entityId: ticket.id };
      let status = ticket.status;
      let priority = ticket.priority;

      if (input.status !== undefined && input.status !== ticket.status) {
        if (!FORWARD[ticket.status].includes(input.status)) {
          throw new AppError(
            "TICKET_INVALID_TRANSITION",
            `Un ticket ${ticket.status === "RESUELTO" ? "resuelto" : "en ese estado"} no puede pasar a ese estado`,
            409,
          );
        }
        await addEvent(tx, ticket, actor.userId, "ESTADO", ticket.status, input.status);
        await recordAuditEvent(tx, {
          ...audit,
          ...entity,
          action: "TicketEstadoCambiado",
          summary: { from: ticket.status, to: input.status },
        });
        status = input.status;
        changed.push("status");
      }
      if (input.priority !== undefined && input.priority !== ticket.priority) {
        await addEvent(tx, ticket, actor.userId, "PRIORIDAD", ticket.priority, input.priority);
        await recordAuditEvent(tx, {
          ...audit,
          ...entity,
          action: "TicketPrioridadCambiada",
          summary: { from: ticket.priority, to: input.priority },
        });
        priority = input.priority;
        changed.push("priority");
      }
      if (input.response !== undefined && input.response !== ticket.response) {
        await addEvent(tx, ticket, actor.userId, "RESPUESTA", ticket.response, input.response);
        await recordAuditEvent(tx, {
          ...audit,
          ...entity,
          action: "TicketRespondido",
          summary: { length: input.response.length },
        });
        changed.push("response");
      }
      if (changed.length > 0) {
        await tx.query(
          `update public.support_tickets
              set status = $2, priority = $3, response = $4, updated_at = now() where id = $1`,
          [ticket.id, status, priority, input.response ?? ticket.response],
        );
      }
      return { ticketId: ticket.id, changed, status, priority };
    }, deps.db);
  } catch (error) {
    throw translateLockTimeout(error);
  }
}

/** El Admin cierra un ticket resuelto (CERRADO es final) o lo reabre porque no quedó resuelto. */
export async function closeOrReopenTicket(
  deps: TicketDeps,
  actor: SessionContext,
  ticketId: string,
  action: "cerrar" | "reabrir",
): Promise<{ ticketId: string; status: TicketStatus }> {
  const businessId = await authorizeBusinessAdmin(
    deps.db,
    actor,
    action === "cerrar" ? "TicketCerrado" : "TicketReabierto",
  );
  const target: TicketStatus = action === "cerrar" ? "CERRADO" : "ABIERTO";
  try {
    return await withTransaction(async (tx) => {
      await setLockTimeout(tx);
      const ticket = await lockTicket(tx, ticketId, businessId);
      if (ticket.status !== "RESUELTO") {
        throw new AppError(
          "TICKET_NOT_RESOLVED",
          "Solo se puede cerrar o reabrir un ticket resuelto",
          409,
        );
      }
      await addEvent(tx, ticket, actor.userId, "ESTADO", ticket.status, target);
      await tx.query(
        "update public.support_tickets set status = $2, updated_at = now() where id = $1",
        [ticket.id, target],
      );
      await recordAuditEvent(tx, {
        businessId,
        actorId: actor.userId,
        action: action === "cerrar" ? "TicketCerrado" : "TicketReabierto",
        entityType: "support_ticket",
        entityId: ticket.id,
        summary: { from: ticket.status, to: target },
      });
      return { ticketId: ticket.id, status: target };
    }, deps.db);
  } catch (error) {
    throw translateLockTimeout(error);
  }
}
