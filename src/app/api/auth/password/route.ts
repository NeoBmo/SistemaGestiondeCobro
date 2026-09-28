import { completeFirstPasswordChange } from "@/modules/identity/password";
import { requireSession } from "@/modules/identity/require-session";
import { firstPasswordChangeSchema } from "@/modules/identity/validation";
import { getPool } from "@/shared/database/pg-pool";
import { createSupabaseServerClient } from "@/shared/database/supabase-server";
import {
  assertSameOrigin,
  commandResponse,
  errorResponse,
  parseBody,
  readJsonBody,
} from "@/shared/http/command-response";

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    // Primero se autentica: sin sesión la respuesta es 401, no un 400 por el cuerpo.
    const context = await requireSession({ allowPasswordChangePending: true });
    const { newPassword } = parseBody(firstPasswordChangeSchema, await readJsonBody(request));
    await completeFirstPasswordChange(
      { supabase: await createSupabaseServerClient(), db: getPool() },
      context,
      newPassword,
    );
    return commandResponse({});
  } catch (error) {
    return errorResponse(error);
  }
}
