import { afterEach, describe, expect, it, vi } from "vitest";
import { postCommand } from "./command-client";

afterEach(() => vi.unstubAllGlobals());

describe("postCommand con cabeceras", () => {
  it("envía Idempotency-Key junto al tipo JSON, y el tipo JSON no se puede pisar", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true, data: { a: 1 } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await postCommand(
      "/api/x",
      { amount: 5 },
      { headers: { "Idempotency-Key": "k-1", "content-type": "text/plain" } },
    );

    expect(result).toEqual({ ok: true, data: { a: 1 } });
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.headers).toEqual({ "Idempotency-Key": "k-1", "content-type": "application/json" });
    expect(init.body).toBe(JSON.stringify({ amount: 5 }));
  });
});
