import { assignClient } from "@/modules/collections/assignments";
import { assignClientSchema } from "@/modules/collections/validation";
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

/** Asigna un cliente a una ruta; si ya tenía una asignación activa, la reasigna. Solo el Admin de negocio. */
export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const actor = await requireSession();
    const db = getPool();
    await authorizeBusinessAdmin(db, actor, "ClienteAsignado");
    const input = parseBody(assignClientSchema, await readJsonBody(request));
    return commandResponse(await assignClient({ db }, actor, input), 201);
  } catch (error) {
    return errorResponse(error);
  }
}
