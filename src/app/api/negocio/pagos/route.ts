import { authorizeBusinessAdmin } from "@/modules/identity/authorize-business-admin";
import { requireSession } from "@/modules/identity/require-session";
import { paymentSchema } from "@/modules/portfolio/loan-validation";
import { registerPayment } from "@/modules/portfolio/payments";
import { getPool } from "@/shared/database/pg-pool";
import {
  assertSameOrigin,
  commandResponse,
  errorResponse,
  parseBody,
  readJsonBody,
} from "@/shared/http/command-response";
import { parseIdempotencyKey } from "@/shared/ids/idempotency-key";

/**
 * Registra un pago (de cuotas, o contra un cargo de mora). Solo el Admin de negocio; clave de idempotencia
 * en `Idempotency-Key`: reenviar el mismo envío devuelve el resultado guardado (200) sin cobrar otra vez.
 * Se autoriza antes de validar la clave y el cuerpo.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const actor = await requireSession();
    const db = getPool();
    await authorizeBusinessAdmin(db, actor, "RegistrarPago");

    const idempotencyKey = parseIdempotencyKey(request.headers.get("idempotency-key"));
    const input = parseBody(paymentSchema, await readJsonBody(request));
    const outcome = await registerPayment({ db }, actor, { ...input, idempotencyKey });

    return commandResponse(
      { ...outcome.result, replayed: outcome.replayed },
      outcome.replayed ? 200 : 201,
    );
  } catch (error) {
    return errorResponse(error, request);
  }
}
