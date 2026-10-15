import { authorizeBusinessAdmin } from "@/modules/identity/authorize-business-admin";
import { requireSession } from "@/modules/identity/require-session";
import { annulContract } from "@/modules/portfolio/contracts";
import { annulContractSchema, loanIdSchema } from "@/modules/portfolio/loan-validation";
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

type RouteContext = { params: Promise<{ loanId: string }> };

/**
 * Anula el contrato y el préstamo con motivo y revierte el desembolso. Solo el Admin de negocio; clave de
 * idempotencia en `Idempotency-Key`. Se autoriza antes de validar el id, la clave y el cuerpo.
 */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    assertSameOrigin(request);
    const { loanId: rawLoanId } = await context.params;
    const actor = await requireSession();
    const db = getPool();
    await authorizeBusinessAdmin(db, actor, "AnularContrato");

    const loanId = loanIdSchema.safeParse(rawLoanId);
    if (!loanId.success) throw new AppError("LOAN_NOT_FOUND", "El préstamo no existe", 404);
    const idempotencyKey = parseIdempotencyKey(request.headers.get("idempotency-key"));
    const { reason } = parseBody(annulContractSchema, await readJsonBody(request));
    const outcome = await annulContract({ db }, actor, {
      idempotencyKey,
      loanId: loanId.data,
      reason,
    });

    return commandResponse({ ...outcome.result, replayed: outcome.replayed });
  } catch (error) {
    return errorResponse(error, request);
  }
}
