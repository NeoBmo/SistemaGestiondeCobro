import { signInWithUsername } from "@/modules/identity/login";
import { loginSchema } from "@/modules/identity/validation";
import { getPool } from "@/shared/database/pg-pool";
import { createSupabaseServerClient } from "@/shared/database/supabase-server";
import {
  assertSameOrigin,
  commandResponse,
  errorResponse,
  parseBody,
  readJsonBody,
} from "@/shared/http/command-response";
import { getServerEnv } from "@/shared/validation/env";

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const input = parseBody(loginSchema, await readJsonBody(request));
    const result = await signInWithUsername(
      {
        supabase: await createSupabaseServerClient(),
        db: getPool(),
        syntheticEmailDomain: getServerEnv().syntheticEmailDomain,
      },
      input,
    );
    return commandResponse(result);
  } catch (error) {
    return errorResponse(error);
  }
}
