import { requireSession } from "@/modules/identity/require-session";
import { authorizeBusinessAdmin } from "@/modules/identity/authorize-business-admin";
import { createClientSchema } from "@/modules/portfolio/client-validation";
import { createClient } from "@/modules/portfolio/clients";
import { getPool } from "@/shared/database/pg-pool";
import {
  assertSameOrigin,
  commandResponse,
  errorResponse,
  parseBody,
  readJsonBody,
} from "@/shared/http/command-response";

/** Alta de un cliente. Solo el Admin de negocio; el negocio sale de la sesión. */
export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const actor = await requireSession();
    const db = getPool();
    // Primero se autoriza y solo después se valida la entrada (un actor sin permiso recibe 403, no 400).
    await authorizeBusinessAdmin(db, actor, "ClienteCreado");
    const input = parseBody(createClientSchema, await readJsonBody(request));
    return commandResponse(await createClient({ db }, actor, input), 201);
  } catch (error) {
    return errorResponse(error, request);
  }
}
