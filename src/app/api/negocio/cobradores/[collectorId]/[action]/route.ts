import {
  deactivateCollector,
  reactivateCollector,
  resetCollectorPassword,
} from "@/modules/collections/collectors";
import { collectionsIdSchema } from "@/modules/collections/validation";
import { authorizeBusinessAdmin } from "@/modules/identity/authorize-business-admin";
import { requireSession } from "@/modules/identity/require-session";
import { getPool } from "@/shared/database/pg-pool";
import { createSupabaseAdminClient } from "@/shared/database/supabase-admin";
import { AppError } from "@/shared/errors/app-error";
import { assertSameOrigin, commandResponse, errorResponse } from "@/shared/http/command-response";
import { getServerEnv } from "@/shared/validation/env";

type RouteContext = { params: Promise<{ collectorId: string; action: string }> };

const ACTIONS = {
  desactivar: { command: "CobradorDesactivado", run: deactivateCollector },
  reactivar: { command: "CobradorReactivado", run: reactivateCollector },
  restablecer: { command: "ContrasenaRestablecida", run: resetCollectorPassword },
} as const;

/**
 * Desactiva (= bloquea), reactiva o restablece la contraseña de un cobrador. Solo el Admin de negocio;
 * se autoriza antes de validar el id. Sin cuerpo: el negocio y el objetivo salen de la sesión y la ruta.
 */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    assertSameOrigin(request);
    const { collectorId: rawId, action } = await context.params;
    const actor = await requireSession();
    const db = getPool();
    const entry = Object.hasOwn(ACTIONS, action) ? ACTIONS[action as keyof typeof ACTIONS] : null;
    await authorizeBusinessAdmin(db, actor, entry?.command ?? "CobradorDesactivado");

    const collectorId = collectionsIdSchema.safeParse(rawId);
    if (!entry || !collectorId.success) {
      throw new AppError("COLLECTOR_NOT_FOUND", "El cobrador no existe", 404);
    }
    const result = await entry.run(
      {
        db,
        admin: createSupabaseAdminClient(),
        syntheticEmailDomain: getServerEnv().syntheticEmailDomain,
      },
      actor,
      collectorId.data,
    );
    return commandResponse(result);
  } catch (error) {
    return errorResponse(error, request);
  }
}
