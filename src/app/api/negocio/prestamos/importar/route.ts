import { authorizeBusinessAdmin } from "@/modules/identity/authorize-business-admin";
import { requireSession } from "@/modules/identity/require-session";
import { importLoan } from "@/modules/portfolio/imports";
import { importLoanSchema } from "@/modules/portfolio/loan-validation";
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
 * Importa un préstamo de cartera previa (contrato `IMPORTADO`, solo las cuotas que faltan, sin pagos ni
 * movimientos de caja). Solo el Admin de negocio; clave de idempotencia en `Idempotency-Key`. Se autoriza
 * antes de validar la clave y el cuerpo.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const actor = await requireSession();
    const db = getPool();
    await authorizeBusinessAdmin(db, actor, "ImportarPrestamo");

    const idempotencyKey = parseIdempotencyKey(request.headers.get("idempotency-key"));
    const input = parseBody(importLoanSchema, await readJsonBody(request));
    const outcome = await importLoan({ db }, actor, { ...input, idempotencyKey });

    return commandResponse(
      { ...outcome.result, replayed: outcome.replayed },
      outcome.replayed ? 200 : 201,
    );
  } catch (error) {
    return errorResponse(error);
  }
}
