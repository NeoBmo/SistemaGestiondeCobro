import { authHealth, isValidMonitorSecret, runHealthCheck } from "@/modules/monitoring/health";
import { getPool } from "@/shared/database/pg-pool";
import { commandResponse, errorResponse } from "@/shared/http/command-response";
import { getPublicEnv, getServerEnv } from "@/shared/validation/env";

export const dynamic = "force-dynamic";

/**
 * Chequeo de disponibilidad programado (ADR 0011): lo invoca un servicio externo con
 * `Authorization: Bearer <MONITOR_SECRET>`. Verifica la base y la autenticación y guarda el resultado y la
 * latencia. Sin secreto configurado, o con uno incorrecto, responde 404 (no revela que existe). Un chequeo
 * fallido responde 503 para que el servicio externo también lo vea.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const secret = getServerEnv().monitorSecret;
    const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
    if (!isValidMonitorSecret(provided, secret)) {
      return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
    }
    const supabaseUrl = getPublicEnv().supabaseUrl;
    const result = await runHealthCheck({
      db: getPool(),
      checkAuth: () => authHealth(supabaseUrl),
    });
    const response = commandResponse(result, result.ok ? 200 : 503);
    return response;
  } catch (error) {
    return errorResponse(error, request);
  }
}
