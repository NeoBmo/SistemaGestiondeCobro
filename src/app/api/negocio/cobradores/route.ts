import { createCollector } from "@/modules/collections/collectors";
import { createCollectorSchema } from "@/modules/collections/validation";
import { authorizeBusinessAdmin } from "@/modules/identity/authorize-business-admin";
import { requireSession } from "@/modules/identity/require-session";
import { getPool } from "@/shared/database/pg-pool";
import { createSupabaseAdminClient } from "@/shared/database/supabase-admin";
import {
  assertSameOrigin,
  commandResponse,
  errorResponse,
  parseBody,
  readJsonBody,
} from "@/shared/http/command-response";
import { getServerEnv } from "@/shared/validation/env";

/** Alta de un cobrador con su cuenta. Solo el Admin de negocio; la contraseña temporal se devuelve una vez. */
export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const actor = await requireSession();
    const db = getPool();
    await authorizeBusinessAdmin(db, actor, "CobradorCreado");
    const input = parseBody(createCollectorSchema, await readJsonBody(request));
    const result = await createCollector(
      {
        db,
        admin: createSupabaseAdminClient(),
        syntheticEmailDomain: getServerEnv().syntheticEmailDomain,
      },
      actor,
      input,
    );
    return commandResponse(result, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
