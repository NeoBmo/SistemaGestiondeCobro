import { requireSession } from "@/modules/identity/require-session";
import { createBusiness } from "@/modules/subscriptions/create-business";
import { createBusinessSchema } from "@/modules/subscriptions/validation";
import { getPool } from "@/shared/database/pg-pool";
import { createSupabaseAdminClient } from "@/shared/database/supabase-admin";
import {
  assertSameOrigin,
  commandResponse,
  errorResponse,
  parseBody,
  readJsonBody,
} from "@/shared/http/command-response";
import { getServerEnv } from "@/shared/validation/env";

/** Crea un negocio con su suscripción y su cuenta admin inicial. Solo Super Admin. */
export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const actor = await requireSession({ roles: ["SUPER_ADMIN"] });
    const input = parseBody(createBusinessSchema, await readJsonBody(request));
    const result = await createBusiness(
      {
        db: getPool(),
        admin: createSupabaseAdminClient(),
        syntheticEmailDomain: getServerEnv().syntheticEmailDomain,
      },
      actor,
      input,
    );
    return commandResponse(result, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
