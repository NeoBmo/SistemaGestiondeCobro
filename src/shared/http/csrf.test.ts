import { describe, expect, it } from "vitest";
import { assertSameOrigin, readJsonBody } from "./command-response";

// Defensa CSRF de los comandos con cookie de sesión (revisión de F1-T2).

function jsonRequest(body: string, contentType: string) {
  return new Request("http://localhost/api/x", {
    method: "POST",
    headers: { "content-type": contentType },
    body,
  });
}

describe("readJsonBody: tipo MIME exacto", () => {
  it("no acepta application/json escondido dentro de otro tipo (petición simple cross-site)", async () => {
    await expect(
      readJsonBody(jsonRequest("{}", "text/plain;x=application/json")),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_MEDIA_TYPE", status: 415 });
  });

  it("acepta parámetros legítimos y mayúsculas", async () => {
    expect(await readJsonBody(jsonRequest('{"a":1}', "Application/JSON; charset=utf-8"))).toEqual({
      a: 1,
    });
  });
});

describe("assertSameOrigin", () => {
  const request = (headers: Record<string, string>) =>
    new Request("https://app.cuadre.test/api/auth/login", { method: "POST", headers });

  it("acepta same-origin, acciones directas (none) y llamadas sin cabeceras de navegador", () => {
    expect(() => assertSameOrigin(request({ "sec-fetch-site": "same-origin" }))).not.toThrow();
    expect(() => assertSameOrigin(request({ "sec-fetch-site": "none" }))).not.toThrow();
    expect(() => assertSameOrigin(request({}))).not.toThrow();
  });

  it("acepta un Origin igual al host que recibió la petición, también tras un proxy", () => {
    expect(() =>
      assertSameOrigin(request({ origin: "https://app.cuadre.test", host: "app.cuadre.test" })),
    ).not.toThrow();
    expect(() =>
      assertSameOrigin(
        request({
          origin: "https://app.cuadre.test",
          host: "interno:3000",
          "x-forwarded-host": "app.cuadre.test",
        }),
      ),
    ).not.toThrow();
  });

  it("rechaza (403) same-site, cross-site y un Origin de otro sitio o inválido", () => {
    const attacks: Record<string, string>[] = [
      { "sec-fetch-site": "cross-site" },
      { "sec-fetch-site": "same-site" },
      { origin: "https://malo.example", host: "app.cuadre.test" },
      { origin: "null", host: "app.cuadre.test" },
    ];
    for (const headers of attacks) {
      expect(() => assertSameOrigin(request(headers)), JSON.stringify(headers)).toThrowError(
        expect.objectContaining({ code: "CROSS_SITE_REQUEST", status: 403 }),
      );
    }
  });
});
