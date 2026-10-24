import { requireSession } from "@/modules/identity/require-session";
import { registerUsuryRate, usuryRateSchema } from "@/modules/portfolio/usury";
import { getPool } from "@/shared/database/pg-pool";
import {
  assertSameOrigin,
  commandResponse,
  errorResponse,
  parseBody,
  readJsonBody,
} from "@/shared/http/command-response";

/** El Super Admin registra la tasa de usura vigente (E.A., desde qué fecha rige y su fuente). */
export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const actor = await requireSession({ roles: ["SUPER_ADMIN"] });
    const input = parseBody(usuryRateSchema, await readJsonBody(request));
    return commandResponse(await registerUsuryRate({ db: getPool() }, actor, input), 201);
  } catch (error) {
    return errorResponse(error, request);
  }
}
