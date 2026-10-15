import { createRoute } from "@/modules/collections/routes";
import { createRouteSchema } from "@/modules/collections/validation";
import { authorizeBusinessAdmin } from "@/modules/identity/authorize-business-admin";
import { requireSession } from "@/modules/identity/require-session";
import { getPool } from "@/shared/database/pg-pool";
import {
  assertSameOrigin,
  commandResponse,
  errorResponse,
  parseBody,
  readJsonBody,
} from "@/shared/http/command-response";

/** Crea la ruta de un cobrador (a lo sumo una activa). Solo el Admin de negocio. */
export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const actor = await requireSession();
    const db = getPool();
    await authorizeBusinessAdmin(db, actor, "RutaCreada");
    const input = parseBody(createRouteSchema, await readJsonBody(request));
    return commandResponse(await createRoute({ db }, actor, input), 201);
  } catch (error) {
    return errorResponse(error, request);
  }
}
