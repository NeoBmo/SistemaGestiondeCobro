import { authorizeBusinessAdmin } from "@/modules/identity/authorize-business-admin";
import { requireSession } from "@/modules/identity/require-session";
import { paymentIdSchema, reversePaymentSchema } from "@/modules/portfolio/loan-validation";
import { reversePayment } from "@/modules/portfolio/payments";
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

type RouteContext = { params: Promise<{ paymentId: string }> };

/**
 * Reversa un pago con motivo (solo el más reciente no reversado del préstamo). Solo el Admin de negocio;
 * clave de idempotencia en `Idempotency-Key`. Se autoriza antes de validar el id, la clave y el cuerpo.
 */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    assertSameOrigin(request);
    const { paymentId: rawPaymentId } = await context.params;
    const actor = await requireSession();
    const db = getPool();
    await authorizeBusinessAdmin(db, actor, "ReversarPago");

    const paymentId = paymentIdSchema.safeParse(rawPaymentId);
    if (!paymentId.success) throw new AppError("PAYMENT_NOT_FOUND", "El pago no existe", 404);
    const idempotencyKey = parseIdempotencyKey(request.headers.get("idempotency-key"));
    const { reason } = parseBody(reversePaymentSchema, await readJsonBody(request));
    const outcome = await reversePayment({ db }, actor, {
      idempotencyKey,
      paymentId: paymentId.data,
      reason,
    });

    return commandResponse({ ...outcome.result, replayed: outcome.replayed });
  } catch (error) {
    return errorResponse(error);
  }
}
