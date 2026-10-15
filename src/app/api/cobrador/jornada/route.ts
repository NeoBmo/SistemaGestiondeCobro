import { openSession } from "@/modules/collections/sessions";
import { authorizeCollector } from "@/modules/identity/authorize-collector";
import { requireSession } from "@/modules/identity/require-session";
import { getPool } from "@/shared/database/pg-pool";
import {
  assertSameOrigin,
  commandResponse,
  errorResponse,
  readJsonBody,
} from "@/shared/http/command-response";
import { parseIdempotencyKey } from "@/shared/ids/idempotency-key";

/** El cobrador abre su jornada de Caja Menor. Solo el Cobrador; clave de idempotencia en `Idempotency-Key`. */
export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const actor = await requireSession();
    const db = getPool();
    await authorizeCollector(db, actor, "AbrirJornada");

    const idempotencyKey = parseIdempotencyKey(request.headers.get("idempotency-key"));
    await readJsonBody(request).catch(() => undefined);
    const outcome = await openSession({ db }, actor, { idempotencyKey });

    return commandResponse(
      { ...outcome.result, replayed: outcome.replayed },
      outcome.replayed ? 200 : 201,
    );
  } catch (error) {
    return errorResponse(error, request);
  }
}
