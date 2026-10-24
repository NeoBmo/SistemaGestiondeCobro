import { describe, expect, it } from "vitest";
import { clientIp } from "./client-ip";

const request = (headers: Record<string, string>) =>
  new Request("https://cuadre.example/api/auth/login", { method: "POST", headers });

describe("clientIp", () => {
  it("en Vercel usa la IP que la plataforma escribe en x-forwarded-for", () => {
    const vercel = { VERCEL: "1" };

    expect(clientIp(request({ "x-forwarded-for": "203.0.113.7" }), vercel)).toBe("203.0.113.7");
    expect(clientIp(request({ "x-forwarded-for": " 2001:db8::1 , 10.0.0.1" }), vercel)).toBe(
      "2001:db8::1",
    );
  });

  it("en Vercel descarta valores que no son una IP", () => {
    const vercel = { VERCEL: "1" };

    for (const value of ["", "unknown", "203.0.113.7:443", "<script>"]) {
      expect(clientIp(request({ "x-forwarded-for": value }), vercel), value).toBeNull();
    }
    expect(clientIp(request({}), vercel)).toBeNull();
  });

  it("fuera de Vercel ignora la cabecera: la escribe quien llama", () => {
    expect(clientIp(request({ "x-forwarded-for": "203.0.113.7" }), {})).toBeNull();
  });
});
