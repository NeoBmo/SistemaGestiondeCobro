import { authorizeBusinessAdmin } from "@/modules/identity/authorize-business-admin";
import { requireSession } from "@/modules/identity/require-session";
import { voidLateFee } from "@/modules/portfolio/late-fees";
import { lateFeeIdSchema, voidLateFeeSchema } from "@/modules/portfolio/loan-validation";
import { getPool } from "@/shared/database/pg-pool";
import { AppError } from "@/shared/errors/app-error";
import {
  assertSameOrigin,
  commandResponse,
  errorResponse,
  parseBody,
  readJsonBody,
} from "@/shared/http/command-response";
import { parseIdempotencyKey } from "@/shared/ids/idempotency-key";

type RouteContext = { params: Promise<{ chargeId: string }> };

/**
 * Anula un cargo de mora con motivo (sin pagos vigentes). Solo el Admin de negocio; clave de idempotencia
 * en `Idempotency-Key`. Se autoriza antes de validar el id, la clave y el cuerpo.
 */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    assertSameOrigin(request);
    const { chargeId: rawChargeId } = await context.params;
    const actor = await requireSession();
    const db = getPool();
    await authorizeBusinessAdmin(db, actor, "AnularCargoMora");

    const chargeId = lateFeeIdSchema.safeParse(rawChargeId);
    if (!chargeId.success)
      throw new AppError("LATE_FEE_NOT_FOUND", "El cargo de mora no existe", 404);
    const idempotencyKey = parseIdempotencyKey(request.headers.get("idempotency-key"));
    const { reason } = parseBody(voidLateFeeSchema, await readJsonBody(request));
    const outcome = await voidLateFee({ db }, actor, {
      idempotencyKey,
      chargeId: chargeId.data,
      reason,
    });

    return commandResponse({ ...outcome.result, replayed: outcome.replayed });
  } catch (error) {
    return errorResponse(error);
  }
}
