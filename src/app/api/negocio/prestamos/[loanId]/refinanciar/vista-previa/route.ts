import { authorizeBusinessAdmin } from "@/modules/identity/authorize-business-admin";
import { requireSession } from "@/modules/identity/require-session";
import { loanIdSchema, refinanceTermsSchema } from "@/modules/portfolio/loan-validation";
import { previewRefinancing } from "@/modules/portfolio/refinancing";
import { getPool } from "@/shared/database/pg-pool";
import { AppError } from "@/shared/errors/app-error";
import {
  assertSameOrigin,
  commandResponse,
  errorResponse,
  parseBody,
  readJsonBody,
} from "@/shared/http/command-response";

type RouteContext = { params: Promise<{ loanId: string }> };

/** Vista previa de una refinanciación: calcula el nuevo préstamo sin guardar nada. */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    assertSameOrigin(request);
    const { loanId: rawLoanId } = await context.params;
    const actor = await requireSession();
    const db = getPool();
    await authorizeBusinessAdmin(db, actor, "VistaPreviaRefinanciacion");

    const loanId = loanIdSchema.safeParse(rawLoanId);
    if (!loanId.success) throw new AppError("LOAN_NOT_FOUND", "El préstamo no existe", 404);
    const terms = parseBody(refinanceTermsSchema, await readJsonBody(request));
    return commandResponse(await previewRefinancing({ db }, actor, loanId.data, terms));
  } catch (error) {
    return errorResponse(error);
  }
}
