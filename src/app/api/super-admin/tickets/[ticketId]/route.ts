import { requireSession } from "@/modules/identity/require-session";
import { attendTicket } from "@/modules/support/tickets";
import { attendTicketSchema, ticketIdSchema } from "@/modules/support/validation";
import { getPool } from "@/shared/database/pg-pool";
import { AppError } from "@/shared/errors/app-error";
import {
  assertSameOrigin,
  commandResponse,
  errorResponse,
  parseBody,
  readJsonBody,
} from "@/shared/http/command-response";

type RouteContext = { params: Promise<{ ticketId: string }> };

/** El Super Admin atiende un ticket: estado hacia adelante, prioridad y respuesta. */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    assertSameOrigin(request);
    const { ticketId: rawId } = await context.params;
    const actor = await requireSession({ roles: ["SUPER_ADMIN"] });
    const ticketId = ticketIdSchema.safeParse(rawId);
    if (!ticketId.success) throw new AppError("TICKET_NOT_FOUND", "El ticket no existe", 404);
    const input = parseBody(attendTicketSchema, await readJsonBody(request));
    return commandResponse(await attendTicket({ db: getPool() }, actor, ticketId.data, input));
  } catch (error) {
    return errorResponse(error, request);
  }
}
