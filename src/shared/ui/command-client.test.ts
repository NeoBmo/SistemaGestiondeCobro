import { describe, expect, it } from "vitest";
import { GENERIC_ERROR, interpretCommandResponse } from "./command-client";

// La UI nunca muestra un código HTTP ni un stack: o el mensaje del servidor (ya escrito para quien lo
// ve) o uno genérico (frontend-design §5).

describe("interpretCommandResponse", () => {
  it("un CommandResult ok devuelve los datos", () => {
    expect(interpretCommandResponse({ ok: true, data: { id: "a" } })).toEqual({
      ok: true,
      data: { id: "a" },
    });
  });

  it("un CommandResult con error conserva código y mensaje del servidor", () => {
    expect(
      interpretCommandResponse({
        ok: false,
        error: { code: "INVALID_CREDENTIALS", message: "Usuario o contraseña incorrectos" },
      }),
    ).toEqual({
      ok: false,
      error: { code: "INVALID_CREDENTIALS", message: "Usuario o contraseña incorrectos" },
    });
  });

  it("cualquier otra forma (HTML de un proxy, null, texto, número) es el error genérico", () => {
    for (const payload of [
      null,
      undefined,
      "<html>502</html>",
      42,
      [],
      {},
      { ok: "sí" },
      { ok: false },
    ]) {
      expect(interpretCommandResponse(payload), JSON.stringify(payload)).toEqual({
        ok: false,
        error: GENERIC_ERROR,
      });
    }
  });

  it("un error sin mensaje utilizable usa el mensaje genérico pero conserva el código", () => {
    expect(interpretCommandResponse({ ok: false, error: { code: "X", message: 5 } })).toEqual({
      ok: false,
      error: { code: "X", message: GENERIC_ERROR.message },
    });
  });

  it("ok: true sin data devuelve undefined como datos (comandos que no devuelven nada)", () => {
    expect(interpretCommandResponse({ ok: true })).toEqual({ ok: true, data: undefined });
  });
});
