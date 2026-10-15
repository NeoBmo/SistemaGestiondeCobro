import { authorizeBusinessAdmin } from "@/modules/identity/authorize-business-admin";
import { requireSession } from "@/modules/identity/require-session";
import { previewImportedLoan } from "@/modules/portfolio/imports";
import { importLoanTermsSchema } from "@/modules/portfolio/loan-validation";
import { getPool } from "@/shared/database/pg-pool";
import {
  assertSameOrigin,
  commandResponse,
  errorResponse,
  parseBody,
  readJsonBody,
} from "@/shared/http/command-response";

/** Vista previa de un préstamo importado: calcula el calendario de las cuotas que faltan sin guardar nada. */
export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const actor = await requireSession();
    const db = getPool();
    await authorizeBusinessAdmin(db, actor, "VistaPreviaImportacion");
    const input = parseBody(importLoanTermsSchema, await readJsonBody(request));
    return commandResponse(await previewImportedLoan({ db }, actor, input));
  } catch (error) {
    return errorResponse(error, request);
  }
}
