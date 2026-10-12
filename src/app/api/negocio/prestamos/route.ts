import { authorizeBusinessAdmin } from "@/modules/identity/authorize-business-admin";
import { requireSession } from "@/modules/identity/require-session";
import { confirmContract } from "@/modules/portfolio/contracts";
import { confirmContractSchema } from "@/modules/portfolio/loan-validation";
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
 * Confirma un contrato y su préstamo (crea cuotas y desembolsa de Caja Mayor). Solo el Admin de
 * negocio. Clave de idempotencia en `Idempotency-Key`: reenviar el mismo envío devuelve el resultado
 * guardado (200) sin desembolsar otra vez. Se autoriza antes de validar la clave y el cuerpo.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const actor = await requireSession();
    const db = getPool();
    await authorizeBusinessAdmin(db, actor, "ConfirmarContrato");

    const idempotencyKey = parseIdempotencyKey(request.headers.get("idempotency-key"));
    const input = parseBody(confirmContractSchema, await readJsonBody(request));
    const outcome = await confirmContract({ db }, actor, { ...input, idempotencyKey });

    return commandResponse(
      { ...outcome.result, replayed: outcome.replayed },
      outcome.replayed ? 200 : 201,
    );
  } catch (error) {
    return errorResponse(error);
  }
}
