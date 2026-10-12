import { authorizeBusinessAdmin } from "@/modules/identity/authorize-business-admin";
import { requireSession } from "@/modules/identity/require-session";
import { previewLoan } from "@/modules/portfolio/contracts";
import { loanTermsSchema } from "@/modules/portfolio/loan-validation";
import { getPool } from "@/shared/database/pg-pool";
import {
  assertSameOrigin,
  commandResponse,
  errorResponse,
  parseBody,
  readJsonBody,
} from "@/shared/http/command-response";

/** Vista previa de un préstamo: calcula interés, total y calendario sin guardar nada. */
export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const actor = await requireSession();
    const db = getPool();
    await authorizeBusinessAdmin(db, actor, "VistaPreviaPrestamo");
    const terms = parseBody(loanTermsSchema, await readJsonBody(request));
    return commandResponse(await previewLoan({ db }, actor, terms));
  } catch (error) {
    return errorResponse(error);
  }
}
