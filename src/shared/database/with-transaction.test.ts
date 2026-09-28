import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { withTransaction } from "./with-transaction";

function fakePool(options: { failOn?: string } = {}) {
  const statements: string[] = [];
  const release = vi.fn();
  const client = {
    query: vi.fn(async (text: string) => {
      statements.push(text);
      if (options.failOn && text === options.failOn) throw new Error(`falla ${text}`);
      return { rows: [], rowCount: 0 };
    }),
    release,
  };
  const pool = { connect: vi.fn(async () => client) } as unknown as Pool;
  return { pool, client, statements, release };
}

describe("withTransaction", () => {
  it("abre BEGIN, ejecuta y hace COMMIT; devuelve el resultado", async () => {
    const { pool, statements, release } = fakePool();

    const result = await withTransaction(async (tx) => {
      await tx.query("SELECT 1");
      return "hecho";
    }, pool);

    expect(result).toBe("hecho");
    expect(statements).toEqual(["BEGIN", "SELECT 1", "COMMIT"]);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("hace ROLLBACK, relanza el error original y libera la conexión", async () => {
    const { pool, statements, release } = fakePool();
    const boom = new Error("regla violada");

    await expect(
      withTransaction(async (tx) => {
        await tx.query("INSERT ...");
        throw boom;
      }, pool),
    ).rejects.toBe(boom);

    expect(statements).toEqual(["BEGIN", "INSERT ...", "ROLLBACK"]);
    expect(statements).not.toContain("COMMIT");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("si COMMIT falla, hace ROLLBACK y relanza el error del COMMIT", async () => {
    const { pool, statements, release } = fakePool({ failOn: "COMMIT" });

    await expect(withTransaction(async () => "x", pool)).rejects.toThrow("falla COMMIT");

    expect(statements).toEqual(["BEGIN", "COMMIT", "ROLLBACK"]);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("si ROLLBACK también falla, conserva el error original y descarta la conexión", async () => {
    const { pool, release } = fakePool({ failOn: "ROLLBACK" });
    const boom = new Error("error original");

    await expect(
      withTransaction(async () => {
        throw boom;
      }, pool),
    ).rejects.toBe(boom);

    // release(true) destruye la conexión en vez de devolverla al pool en estado dudoso
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith(true);
  });

  it("no abre transacción si no se puede obtener conexión", async () => {
    const pool = {
      connect: vi.fn(async () => {
        throw new Error("sin conexión");
      }),
    } as unknown as Pool;

    await expect(withTransaction(async () => "x", pool)).rejects.toThrow("sin conexión");
  });
});
