import type { z } from "zod";
import { AppError, isAppError } from "@/shared/errors/app-error";
import { fail, ok } from "@/shared/types/command-result";

const NO_STORE = { "Cache-Control": "no-store" };

export function commandResponse<T>(data: T, status = 200): Response {
  return Response.json(ok(data), { status, headers: NO_STORE });
}

/** Errores de dominio conservan su código y estado; el resto se oculta tras un 500 genérico. */
export function errorResponse(error: unknown): Response {
  if (isAppError(error)) {
    return Response.json(fail(error.code, error.message), {
      status: error.status,
      headers: NO_STORE,
    });
  }
  // Solo el tipo: el mensaje de un error inesperado puede contener secretos o datos personales.
  console.error("[api] error no controlado:", error instanceof Error ? error.name : typeof error);
  return Response.json(fail("INTERNAL_ERROR", "Ocurrió un error inesperado. Intenta de nuevo."), {
    status: 500,
    headers: NO_STORE,
  });
}

/**
 * Defensa CSRF de los comandos con cookie de sesión: rechaza peticiones cross-site. Usa
 * `Sec-Fetch-Site` (lo envían los navegadores modernos; `none` = acción directa del usuario) y,
 * si hay `Origin`, exige que coincida con el host que recibió la petición. Las llamadas sin esas
 * cabeceras (curl, pruebas) no son CSRF: un navegador siempre las envía.
 */
export function assertSameOrigin(request: Request): void {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") {
    throw new AppError("CROSS_SITE_REQUEST", "Petición no permitida desde otro sitio", 403);
  }

  const origin = request.headers.get("origin");
  if (origin) {
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      // Origin inválido (p. ej. "null"): se trata como no coincidente.
    }
    if (originHost === null || originHost !== host) {
      throw new AppError("CROSS_SITE_REQUEST", "Petición no permitida desde otro sitio", 403);
    }
  }
}

/**
 * Exige JSON con el tipo MIME exacto: un formulario de otro sitio no puede enviar
 * `application/json` sin preflight CORS, y `text/plain;x=application/json` no se acepta.
 */
export async function readJsonBody(request: Request): Promise<unknown> {
  const mime = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (mime !== "application/json") {
    throw new AppError("UNSUPPORTED_MEDIA_TYPE", "La petición debe enviarse como JSON", 415);
  }
  try {
    return await request.json();
  } catch {
    throw new AppError("INVALID_JSON", "El cuerpo de la petición no es JSON válido");
  }
}

/** Valida con Zod sin devolver al cliente los valores recibidos. */
export function parseBody<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new AppError("INVALID_REQUEST", "La petición no tiene el formato esperado");
  }
  return result.data;
}
