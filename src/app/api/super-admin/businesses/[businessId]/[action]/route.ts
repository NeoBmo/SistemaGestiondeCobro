import { requireSession } from "@/modules/identity/require-session";
import type { LifecycleCommand } from "@/modules/subscriptions/lifecycle-rules";
import {
  activateBusiness,
  archiveBusiness,
  authorizeLifecycle,
  changePlan,
  resubscribeBusiness,
  suspendBusiness,
  type LifecycleResult,
} from "@/modules/subscriptions/lifecycle";
import {
  archiveBodySchema,
  businessIdSchema,
  noteBodySchema,
  planBodySchema,
} from "@/modules/subscriptions/validation";
import { getPool } from "@/shared/database/pg-pool";
import { AppError } from "@/shared/errors/app-error";
import {
  assertSameOrigin,
  commandResponse,
  errorResponse,
  parseBody,
  readJsonBody,
} from "@/shared/http/command-response";

type RouteContext = { params: Promise<{ businessId: string; action: string }> };

const COMMANDS: Record<string, LifecycleCommand | undefined> = {
  suspend: "SUSPEND",
  activate: "ACTIVATE",
  archive: "ARCHIVE",
  plan: "CHANGE_PLAN",
  resubscribe: "RESUBSCRIBE",
};

/** Un id inválido no corresponde a ningún negocio: autoriza (403) sin dejar evento de auditoría. */
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

/**
 * Ciclo de vida de un negocio (solo Super Admin; el servicio autoriza y audita):
 * `suspend`, `activate`, `archive` (con motivo), `plan` (cambiar de plan) y `resubscribe`.
 */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    assertSameOrigin(request);
    const { businessId: rawBusinessId, action } = await context.params;
    const actor = await requireSession();

    const command = COMMANDS[action];
    if (!command) throw new AppError("UNKNOWN_ACTION", "La acción solicitada no existe", 404);

    // Primero se autoriza y solo después se valida la entrada: un actor sin permiso recibe 403 (y deja
    // su evento RECHAZADO si el negocio existe), nunca un 400 que le detalle el formato esperado.
    const parsedId = businessIdSchema.safeParse(rawBusinessId);
    const deps = { db: getPool() };
    await authorizeLifecycle(deps, actor, command, parsedId.success ? parsedId.data : NIL_UUID);

    if (!parsedId.success)
      throw new AppError("INVALID_REQUEST", "El negocio indicado no es válido");
    const businessId = parsedId.data;
    const body = await readJsonBody(request);
    let result: LifecycleResult;

    switch (action) {
      case "suspend":
        result = await suspendBusiness(deps, actor, {
          businessId,
          ...parseBody(noteBodySchema, body),
        });
        break;
      case "activate":
        result = await activateBusiness(deps, actor, {
          businessId,
          ...parseBody(noteBodySchema, body),
        });
        break;
      case "archive":
        result = await archiveBusiness(deps, actor, {
          businessId,
          ...parseBody(archiveBodySchema, body),
        });
        break;
      case "plan":
        result = await changePlan(deps, actor, { businessId, ...parseBody(planBodySchema, body) });
        break;
      case "resubscribe":
        result = await resubscribeBusiness(deps, actor, {
          businessId,
          ...parseBody(planBodySchema, body),
        });
        break;
      default:
        throw new AppError("UNKNOWN_ACTION", "La acción solicitada no existe", 404);
    }
    return commandResponse(result);
  } catch (error) {
    return errorResponse(error);
  }
}
