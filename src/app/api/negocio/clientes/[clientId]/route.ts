import { authorizeBusinessAdmin } from "@/modules/identity/authorize-business-admin";
import { requireSession } from "@/modules/identity/require-session";
import { clientIdSchema, updateClientSchema } from "@/modules/portfolio/client-validation";
import { updateClient } from "@/modules/portfolio/clients";
import { getPool } from "@/shared/database/pg-pool";
import { AppError } from "@/shared/errors/app-error";
import {
  assertSameOrigin,
  commandResponse,
  errorResponse,
  parseBody,
  readJsonBody,
} from "@/shared/http/command-response";

type RouteContext = { params: Promise<{ clientId: string }> };

/** Edición del contacto de un cliente (la identificación no se edita). Solo el Admin de negocio. */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    assertSameOrigin(request);
    const { clientId: rawClientId } = await context.params;
    const actor = await requireSession();
    const db = getPool();
    await authorizeBusinessAdmin(db, actor, "ClienteActualizado");

    const clientId = clientIdSchema.safeParse(rawClientId);
    if (!clientId.success) throw new AppError("CLIENT_NOT_FOUND", "El cliente no existe", 404);
    const input = parseBody(updateClientSchema, await readJsonBody(request));
    const { client, changed } = await updateClient({ db }, actor, clientId.data, input);
    return commandResponse({ client, changed });
  } catch (error) {
    return errorResponse(error);
  }
}
