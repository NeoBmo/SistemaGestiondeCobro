import { describe, expect, it } from "vitest";
import { fail, ok, type CommandResult } from "./command-result";

describe("CommandResult", () => {
  it("ok envuelve los datos", () => {
    const result: CommandResult<{ id: string }> = ok({ id: "a" });

    expect(result).toEqual({ ok: true, data: { id: "a" } });
  });

  it("fail envuelve code y message", () => {
    const result: CommandResult<never> = fail("PAYMENT_EXCEEDS_BALANCE", "El pago supera el saldo");

    expect(result).toEqual({
      ok: false,
      error: { code: "PAYMENT_EXCEEDS_BALANCE", message: "El pago supera el saldo" },
    });
  });

  it("permite estrechar por el discriminante ok", () => {
    const result: CommandResult<number> = ok(5);

    if (result.ok) {
      expect(result.data).toBe(5);
    } else {
      expect.unreachable("debería ser ok");
    }
  });
});
