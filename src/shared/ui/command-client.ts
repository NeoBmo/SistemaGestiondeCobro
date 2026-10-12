export type ClientError = { code: string; message: string };

export type ClientResult<T> = { ok: true; data: T } | { ok: false; error: ClientError };

/** Mensaje cuando la respuesta no es un CommandResult (red caída, HTML de un proxy, 500 sin cuerpo). */
export const GENERIC_ERROR: ClientError = {
  code: "UNEXPECTED_RESPONSE",
  message: "No se pudo completar la operación. Revisa tu conexión e intenta de nuevo.",
};

/**
 * Interpreta el cuerpo de una respuesta de los Route Handlers (`CommandResult`, 03-ARQUITECTURA §3).
 * Nunca expone nada que no sea el mensaje que el servidor ya redactó para el usuario.
 */
export function interpretCommandResponse<T = unknown>(payload: unknown): ClientResult<T> {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return { ok: false, error: GENERIC_ERROR };
  }
  const body = payload as { ok?: unknown; data?: unknown; error?: unknown };

  if (body.ok === true) return { ok: true, data: body.data as T };

  if (body.ok === false && typeof body.error === "object" && body.error !== null) {
    const error = body.error as { code?: unknown; message?: unknown };
    return {
      ok: false,
      error: {
        code: typeof error.code === "string" ? error.code : GENERIC_ERROR.code,
        message: typeof error.message === "string" ? error.message : GENERIC_ERROR.message,
      },
    };
  }
  return { ok: false, error: GENERIC_ERROR };
}

/**
 * POST JSON a un Route Handler. No lanza: siempre devuelve un resultado interpretable por la UI.
 * `options.headers` añade cabeceras (p. ej. `Idempotency-Key` en los comandos financieros).
 */
export async function postCommand<T = unknown>(
  url: string,
  body: unknown,
  options: { headers?: Record<string, string> } = {},
): Promise<ClientResult<T>> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { ...options.headers, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return interpretCommandResponse<T>(await response.json());
  } catch {
    return { ok: false, error: GENERIC_ERROR };
  }
}
