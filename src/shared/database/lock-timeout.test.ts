import { describe, expect, it, vi } from "vitest";
import { AppError } from "@/shared/errors/app-error";
import { LOCK_TIMEOUT_MS, setLockTimeout, translateLockTimeout } from "./lock-timeout";

// Un comando que espera un bloqueo de fila no debe retener una conexión del pool indefinidamente:
// si otro comando tarda (p. ej. una llamada lenta a Auth), se corta y se informa en vez de agotar el pool.

describe("setLockTimeout", () => {
  it("fija lock_timeout local a la transacción", async () => {
    const tx = { query: vi.fn(async () => ({ rows: [] })) };

    await setLockTimeout(tx as never);

    expect(tx.query).toHaveBeenCalledWith(`set local lock_timeout = ${LOCK_TIMEOUT_MS}`);
  });

  it("el tope es de segundos, no de minutos", () => {
    expect(LOCK_TIMEOUT_MS).toBeGreaterThanOrEqual(1000);
    expect(LOCK_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
  });
});

describe("translateLockTimeout", () => {
  it("convierte el error 55P03 de PostgreSQL en OPERATION_IN_PROGRESS (409)", () => {
    const translated = translateLockTimeout(
      Object.assign(new Error("lock timeout"), { code: "55P03" }),
    );

    expect(translated).toBeInstanceOf(AppError);
    expect(translated).toMatchObject({ code: "OPERATION_IN_PROGRESS", status: 409 });
  });

  it("deja pasar cualquier otro error sin tocarlo", () => {
    const other = new Error("otra cosa");
    const appError = new AppError("X", "x");

    expect(translateLockTimeout(other)).toBe(other);
    expect(translateLockTimeout(appError)).toBe(appError);
    expect(translateLockTimeout("texto")).toBe("texto");
    expect(translateLockTimeout(null)).toBeNull();
  });
});
