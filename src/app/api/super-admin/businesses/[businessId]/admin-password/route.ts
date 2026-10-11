import { authorizeSuperAdminOnBusiness } from "@/modules/identity/authorize-super-admin";
import { requireSession } from "@/modules/identity/require-session";
import { resetAdminPassword } from "@/modules/identity/reset-admin-password";
import { emptyBodySchema } from "@/modules/identity/validation";
import { businessIdSchema } from "@/modules/subscriptions/validation";
import { getPool } from "@/shared/database/pg-pool";
import { createSupabaseAdminClient } from "@/shared/database/supabase-admin";
import { AppError } from "@/shared/errors/app-error";
import {
  assertSameOrigin,
  commandResponse,
  errorResponse,
  parseBody,
  readJsonBody,
} from "@/shared/http/command-response";

type RouteContext = { params: Promise<{ businessId: string }> };

/** Un id inválido no corresponde a ningún negocio: autoriza (403) sin dejar evento de auditoría. */
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

/**
 * El Super Admin restablece la contraseña del admin del negocio. La respuesta lleva la contraseña
 * temporal, que se muestra una sola vez (`no-store`): no se guarda ni se audita en ningún sitio.
 */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    assertSameOrigin(request);
    const { businessId: rawBusinessId } = await context.params;
    const actor = await requireSession();

    // Primero se autoriza y solo después se valida la entrada (ver la ruta del ciclo de vida).
    const parsedId = businessIdSchema.safeParse(rawBusinessId);
    const db = getPool();
    await authorizeSuperAdminOnBusiness(
      db,
      actor,
      "ContrasenaRestablecida",
      parsedId.success ? parsedId.data : NIL_UUID,
    );
    if (!parsedId.success)
      throw new AppError("INVALID_REQUEST", "El negocio indicado no es válido");
    parseBody(emptyBodySchema, await readJsonBody(request));

    const result = await resetAdminPassword({ db, admin: createSupabaseAdminClient() }, actor, {
      businessId: parsedId.data,
    });
    return commandResponse(result);
  } catch (error) {
    return errorResponse(error);
  }
}
