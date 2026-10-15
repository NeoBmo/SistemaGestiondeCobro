import { dashboardConfigSchema, saveDashboardConfig } from "@/modules/dashboard/settings";
import { authorizeBusinessAdmin } from "@/modules/identity/authorize-business-admin";
import { requireSession } from "@/modules/identity/require-session";
import { getPool } from "@/shared/database/pg-pool";
import {
  assertSameOrigin,
  commandResponse,
  errorResponse,
  parseBody,
  readJsonBody,
} from "@/shared/http/command-response";

/** Guarda la presentación del dashboard (indicadores, orden y periodo). Solo el Admin de un plan mensual o anual. */
export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const actor = await requireSession();
    const db = getPool();
    await authorizeBusinessAdmin(db, actor, "DashboardConfigurado");
    const input = parseBody(dashboardConfigSchema, await readJsonBody(request));
    return commandResponse(await saveDashboardConfig({ db }, actor, input));
  } catch (error) {
    return errorResponse(error, request);
  }
}
