import { describe, expect, it, vi } from "vitest";
import { fetchWithTimeout } from "./supabase-admin";

describe("fetchWithTimeout", () => {
  it("añade una señal con tope a las peticiones que no traen una", async () => {
    const base = vi.fn<typeof fetch>(async () => new Response("ok"));

    await fetchWithTimeout(5000, base)("https://auth.test/x", {
      method: "PUT",
    });

    const init = base.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("PUT");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal?.aborted).toBe(false);
  });

  it("respeta la señal que ya traía la petición", async () => {
    const base = vi.fn<typeof fetch>(async () => new Response("ok"));
    const controller = new AbortController();

    await fetchWithTimeout(5000, base)("https://auth.test/x", {
      signal: controller.signal,
    });

    expect((base.mock.calls[0]?.[1] as RequestInit).signal).toBe(controller.signal);
  });

  it("aborta la petición cuando se agota el tiempo", async () => {
    const hanging = ((_input: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("abortada")));
      })) as unknown as typeof fetch;

    await expect(fetchWithTimeout(20, hanging)("https://auth.test/lento")).rejects.toThrow(
      "abortada",
    );
  });
});
