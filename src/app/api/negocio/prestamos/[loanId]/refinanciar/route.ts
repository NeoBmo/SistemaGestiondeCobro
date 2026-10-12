import { authorizeBusinessAdmin } from "@/modules/identity/authorize-business-admin";
import { requireSession } from "@/modules/identity/require-session";
import { loanIdSchema, refinanceSchema } from "@/modules/portfolio/loan-validation";
import { refinanceLoan } from "@/modules/portfolio/refinancing";
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
 * Refinancia un préstamo: crea un contrato y préstamo nuevos con el saldo pendiente más un monto adicional
 * opcional, y deja el anterior REFINANCIADO. Solo el Admin de negocio; clave de idempotencia en
 * `Idempotency-Key`. Se autoriza antes de validar el id, la clave y el cuerpo.
 */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    assertSameOrigin(request);
    const { loanId: rawLoanId } = await context.params;
    const actor = await requireSession();
    const db = getPool();
    await authorizeBusinessAdmin(db, actor, "RefinanciarPrestamo");

    const loanId = loanIdSchema.safeParse(rawLoanId);
    if (!loanId.success) throw new AppError("LOAN_NOT_FOUND", "El préstamo no existe", 404);
    const idempotencyKey = parseIdempotencyKey(request.headers.get("idempotency-key"));
    const input = parseBody(refinanceSchema, await readJsonBody(request));
    const outcome = await refinanceLoan({ db }, actor, {
      ...input,
      loanId: loanId.data,
      idempotencyKey,
    });

    return commandResponse(
      { ...outcome.result, replayed: outcome.replayed },
      outcome.replayed ? 200 : 201,
    );
  } catch (error) {
    return errorResponse(error);
  }
}
