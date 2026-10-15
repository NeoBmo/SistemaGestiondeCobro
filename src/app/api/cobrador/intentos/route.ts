import { registerAttempt } from "@/modules/collections/attempts";
import { attemptSchema } from "@/modules/collections/validation";
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

/** El cobrador registra un intento fallido o un «volver a cobrar» de un cliente de su cartera. */
export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const actor = await requireSession();
    const db = getPool();
    await authorizeCollector(db, actor, "RegistrarIntentoCobro");

    const idempotencyKey = parseIdempotencyKey(request.headers.get("idempotency-key"));
    const input = parseBody(attemptSchema, await readJsonBody(request));
    const outcome = await registerAttempt({ db }, actor, { ...input, idempotencyKey });

    return commandResponse(
      { ...outcome.result, replayed: outcome.replayed },
      outcome.replayed ? 200 : 201,
    );
  } catch (error) {
    return errorResponse(error, request);
  }
}
