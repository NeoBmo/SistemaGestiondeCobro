import { registerCollectorPayment } from "@/modules/portfolio/payments";
import { paymentSchema } from "@/modules/portfolio/loan-validation";
import { authorizeCollector } from "@/modules/identity/authorize-collector";
import { requireSession } from "@/modules/identity/require-session";
import { getPool } from "@/shared/database/pg-pool";
import {
  assertSameOrigin,
  commandResponse,
  errorResponse,
  parseBody,
  readJsonBody,
} from "@/shared/http/command-response";
import { parseIdempotencyKey } from "@/shared/ids/idempotency-key";

/** El cobrador registra un cobro contra su jornada abierta (solo clientes de su cartera). */
export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const actor = await requireSession();
    const db = getPool();
    await authorizeCollector(db, actor, "RegistrarPago");

    const idempotencyKey = parseIdempotencyKey(request.headers.get("idempotency-key"));
    const input = parseBody(paymentSchema, await readJsonBody(request));
    const outcome = await registerCollectorPayment({ db }, actor, { ...input, idempotencyKey });

    return commandResponse(
      { ...outcome.result, replayed: outcome.replayed },
      outcome.replayed ? 200 : 201,
    );
  } catch (error) {
    return errorResponse(error, request);
  }
}
