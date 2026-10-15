import type { Pool } from "pg";
import { getPool } from "@/shared/database/pg-pool";
import { setUnexpectedErrorReporter } from "@/shared/http/command-response";

/**
 * Registro centralizado de errores inesperados (ADR 0011): solo la ruta (sin identificadores) y el tipo del
 * error, nunca su mensaje ni datos de usuarios o negocios. Es de mejor esfuerzo y no espera: un fallo al
 * registrar nunca altera la respuesta ni se propaga.
 */
export async function recordPlatformError(
  db: Pick<Pool, "query">,
  report: { route: string; errorName: string },
): Promise<void> {
  try {
    await db.query(
      "insert into public.platform_events (kind, route, error_name) values ('ERROR_500', $1, $2)",
      [report.route.slice(0, 200), report.errorName.slice(0, 100)],
    );
  } catch {
    // Sin detalle: puede contener datos de la conexión.
    console.error("[monitoring] no se pudo registrar el error de plataforma");
  }
}

/** Conecta el reporte de errores de los Route Handlers con el registro de plataforma (al arrancar). */
export function installErrorReporter(): void {
  // En pruebas no se escribe en la base por un error provocado a propósito.
  if (process.env.NODE_ENV === "test") return;
  setUnexpectedErrorReporter((report) => {
    void recordPlatformError(getPool(), report);
  });
}
