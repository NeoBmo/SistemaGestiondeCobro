import { closeRoute } from "@/modules/collections/routes";
import { collectionsIdSchema } from "@/modules/collections/validation";
import { authorizeBusinessAdmin } from "@/modules/identity/authorize-business-admin";
import { requireSession } from "@/modules/identity/require-session";
import { getPool } from "@/shared/database/pg-pool";
import { AppError } from "@/shared/errors/app-error";
import { assertSameOrigin, commandResponse, errorResponse } from "@/shared/http/command-response";

type RouteContext = { params: Promise<{ routeId: string }> };

/** Cierra una ruta sin clientes asignados. Solo el Admin de negocio; se autoriza antes de validar el id. */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    assertSameOrigin(request);
    const { routeId: rawId } = await context.params;
    const actor = await requireSession();
    const db = getPool();
    await authorizeBusinessAdmin(db, actor, "RutaCerrada");
    const routeId = collectionsIdSchema.safeParse(rawId);
    if (!routeId.success) throw new AppError("ROUTE_NOT_FOUND", "La ruta no existe", 404);
    return commandResponse(await closeRoute({ db }, actor, routeId.data));
  } catch (error) {
    return errorResponse(error);
  }
}
