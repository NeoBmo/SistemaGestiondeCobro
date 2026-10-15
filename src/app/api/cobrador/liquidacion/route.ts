import { declareSettlement } from "@/modules/collections/settlements";
import { declareSettlementSchema } from "@/modules/collections/validation";
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

/** El cobrador declara lo que entrega y cierra su jornada abierta. Solo el Cobrador; clave de idempotencia. */
export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const actor = await requireSession();
    const db = getPool();
    await authorizeCollector(db, actor, "DeclararLiquidacion");

    const idempotencyKey = parseIdempotencyKey(request.headers.get("idempotency-key"));
    const input = parseBody(declareSettlementSchema, await readJsonBody(request));
    const outcome = await declareSettlement({ db }, actor, { ...input, idempotencyKey });
    return commandResponse(
      { ...outcome.result, replayed: outcome.replayed },
      outcome.replayed ? 200 : 201,
    );
  } catch (error) {
    return errorResponse(error, request);
  }
}
