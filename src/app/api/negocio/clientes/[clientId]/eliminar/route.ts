import { authorizeBusinessAdmin } from "@/modules/identity/authorize-business-admin";
import { requireSession } from "@/modules/identity/require-session";
import { clientIdSchema } from "@/modules/portfolio/client-validation";
import { deleteClient } from "@/modules/portfolio/clients";
import { getPool } from "@/shared/database/pg-pool";
import { AppError } from "@/shared/errors/app-error";
import { assertSameOrigin, commandResponse, errorResponse } from "@/shared/http/command-response";

type RouteContext = { params: Promise<{ clientId: string }> };

/**
 * Elimina un cliente sin contratos ni préstamos (02 §2.1). Solo el Admin de negocio; se autoriza antes
 * de validar el id. Sin cuerpo: el negocio sale de la sesión y el cliente de la ruta.
 */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    assertSameOrigin(request);
    const { clientId: rawClientId } = await context.params;
    const actor = await requireSession();
    const db = getPool();
    await authorizeBusinessAdmin(db, actor, "ClienteEliminado");

    const clientId = clientIdSchema.safeParse(rawClientId);
    if (!clientId.success) throw new AppError("CLIENT_NOT_FOUND", "El cliente no existe", 404);
    return commandResponse(await deleteClient({ db }, actor, clientId.data));
  } catch (error) {
    return errorResponse(error, request);
  }
}
