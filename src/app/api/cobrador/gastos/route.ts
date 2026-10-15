import { registerCollectorExpense } from "@/modules/collections/sessions";
import { expenseSchema } from "@/modules/cash/validation";
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

/** El cobrador registra un gasto contra su jornada abierta. */
export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const actor = await requireSession();
    const db = getPool();
    await authorizeCollector(db, actor, "RegistrarGastoCobrador");

    const idempotencyKey = parseIdempotencyKey(request.headers.get("idempotency-key"));
    const input = parseBody(expenseSchema, await readJsonBody(request));
    const outcome = await registerCollectorExpense({ db }, actor, { ...input, idempotencyKey });

    return commandResponse(
      { ...outcome.result, replayed: outcome.replayed },
      outcome.replayed ? 200 : 201,
    );
  } catch (error) {
    return errorResponse(error, request);
  }
}
