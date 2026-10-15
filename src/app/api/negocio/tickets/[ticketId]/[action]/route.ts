import { authorizeBusinessAdmin } from "@/modules/identity/authorize-business-admin";
import { requireSession } from "@/modules/identity/require-session";
import { closeOrReopenTicket } from "@/modules/support/tickets";
import { ticketIdSchema } from "@/modules/support/validation";
import { getPool } from "@/shared/database/pg-pool";
import { AppError } from "@/shared/errors/app-error";
import { assertSameOrigin, commandResponse, errorResponse } from "@/shared/http/command-response";

type RouteContext = { params: Promise<{ ticketId: string; action: string }> };

const ACTIONS = { cerrar: "TicketCerrado", reabrir: "TicketReabierto" } as const;

/** El Admin cierra un ticket resuelto o lo reabre. Se autoriza antes de validar el id. */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    assertSameOrigin(request);
    const { ticketId: rawId, action } = await context.params;
    const actor = await requireSession();
    const db = getPool();
    const known = Object.hasOwn(ACTIONS, action);
    await authorizeBusinessAdmin(
      db,
      actor,
      known ? ACTIONS[action as keyof typeof ACTIONS] : "TicketCerrado",
    );
    const ticketId = ticketIdSchema.safeParse(rawId);
    if (!known || !ticketId.success)
      throw new AppError("TICKET_NOT_FOUND", "El ticket no existe", 404);
    return commandResponse(
      await closeOrReopenTicket({ db }, actor, ticketId.data, action as keyof typeof ACTIONS),
    );
  } catch (error) {
    return errorResponse(error, request);
  }
}
