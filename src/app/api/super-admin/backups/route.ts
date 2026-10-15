import { requireSession } from "@/modules/identity/require-session";
import { backupCheckSchema, registerBackupCheck } from "@/modules/monitoring/backups";
import { getPool } from "@/shared/database/pg-pool";
import {
  assertSameOrigin,
  commandResponse,
  errorResponse,
  parseBody,
  readJsonBody,
} from "@/shared/http/command-response";

/** El Super Admin registra la verificación de un backup (fecha, resultado y nota). */
export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const actor = await requireSession({ roles: ["SUPER_ADMIN"] });
    const input = parseBody(backupCheckSchema, await readJsonBody(request));
    return commandResponse(await registerBackupCheck({ db: getPool() }, actor, input), 201);
  } catch (error) {
    return errorResponse(error, request);
  }
}
