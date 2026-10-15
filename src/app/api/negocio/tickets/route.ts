import { authorizeBusinessAdmin } from "@/modules/identity/authorize-business-admin";
import { requireSession } from "@/modules/identity/require-session";
import { createTicket } from "@/modules/support/tickets";
import { createTicketSchema } from "@/modules/support/validation";
import { getPool } from "@/shared/database/pg-pool";
import {
  assertSameOrigin,
  commandResponse,
  errorResponse,
  parseBody,
  readJsonBody,
} from "@/shared/http/command-response";

/** El Admin abre un ticket de soporte para su negocio. */
export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const actor = await requireSession();
    const db = getPool();
    await authorizeBusinessAdmin(db, actor, "TicketCreado");
    const input = parseBody(createTicketSchema, await readJsonBody(request));
    return commandResponse(await createTicket({ db }, actor, input), 201);
  } catch (error) {
    return errorResponse(error, request);
  }
}
