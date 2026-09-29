import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AppError } from "@/shared/errors/app-error";
import { commandResponse, errorResponse, parseBody, readJsonBody } from "./command-response";

afterEach(() => vi.restoreAllMocks());

function jsonRequest(body: string, contentType = "application/json") {
  return new Request("http://localhost/api/x", {
    method: "POST",
    headers: { "content-type": contentType },
    body,
  });
}

describe("commandResponse", () => {
  it("envuelve los datos como CommandResult ok, sin caché", async () => {
    const res = commandResponse({ id: "a" });

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true, data: { id: "a" } });
  });
});

describe("errorResponse", () => {
  it("un AppError conserva código, mensaje y estado", async () => {
    const res = errorResponse(new AppError("FORBIDDEN", "No tienes permiso", 403));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      ok: false,
      error: { code: "FORBIDDEN", message: "No tienes permiso" },
    });
  });

  it("un error inesperado devuelve 500 genérico y no filtra su mensaje ni lo registra", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = errorResponse(
      new Error("password authentication failed for user postgres:secreto"),
    );
    const text = await res.text();

    expect(res.status).toBe(500);
    expect(text).toContain("INTERNAL_ERROR");
    expect(text).not.toContain("secreto");
    expect(JSON.stringify(log.mock.calls)).not.toContain("secreto");
  });
});

describe("readJsonBody", () => {
  it("lee un cuerpo JSON", async () => {
    expect(await readJsonBody(jsonRequest('{"a":1}'))).toEqual({ a: 1 });
  });

  it("rechaza otro content-type con 415 (defensa CSRF con formularios de otros sitios)", async () => {
    await expect(
      readJsonBody(jsonRequest("a=1", "application/x-www-form-urlencoded")),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_MEDIA_TYPE", status: 415 });
  });

  it("rechaza JSON malformado con 400", async () => {
    await expect(readJsonBody(jsonRequest("{no es json"))).rejects.toMatchObject({
      code: "INVALID_JSON",
      status: 400,
    });
  });
});

describe("parseBody", () => {
  const schema = z.object({ username: z.string().min(1) });

  it("devuelve los datos validados", () => {
    expect(parseBody(schema, { username: "juan" })).toEqual({ username: "juan" });
  });

  it("lanza INVALID_REQUEST sin repetir los valores recibidos", () => {
    try {
      parseBody(schema, { username: 42, password: "SuperSecreta1" });
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ code: "INVALID_REQUEST", status: 400 });
      expect((error as AppError).message).not.toContain("SuperSecreta1");
    }
  });
});
