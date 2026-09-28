import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { withTransaction } from "@/shared/database/with-transaction";
import { createTestPool, sleep } from "./helpers/db";

// 03-ARQUITECTURA §3: una sola transacción, todo o nada, con bloqueos explícitos.

const pool = createTestPool();

beforeAll(async () => {
  await pool.query("drop table if exists it_ledger, it_counter");
  await pool.query("create table it_counter (id int primary key, n int not null)");
  await pool.query("create table it_ledger (id serial primary key, note text not null)");
});

beforeEach(async () => {
  await pool.query("delete from it_ledger");
  await pool.query("delete from it_counter");
  await pool.query("insert into it_counter (id, n) values (1, 0)");
});

afterAll(async () => {
  await pool.query("drop table if exists it_ledger, it_counter");
  await pool.end();
});

async function ledgerCount(note: string): Promise<number> {
  const { rows } = await pool.query<{ total: number }>(
    "select count(*)::int as total from it_ledger where note = $1",
    [note],
  );
  return rows[0]?.total ?? -1;
}

async function counter(): Promise<number> {
  const { rows } = await pool.query<{ n: number }>("select n from it_counter where id = 1");
  return rows[0]?.n ?? -1;
}

/** Lee el contador, espera y escribe +1: sin control de concurrencia se pierden incrementos. */
function bump(lock: "row" | "advisory" | "none") {
  return withTransaction(async (tx) => {
    if (lock === "advisory") await tx.query("select pg_advisory_xact_lock(hashtext('it_counter'))");
    const suffix = lock === "row" ? " for update" : "";
    const { rows } = await tx.query<{ n: number }>(
      `select n from it_counter where id = 1${suffix}`,
    );
    await sleep(100);
    await tx.query("update it_counter set n = $1 where id = 1", [(rows[0]?.n ?? 0) + 1]);
  }, pool);
}

describe("withTransaction contra PostgreSQL real", () => {
  it("confirma los cambios al terminar sin error", async () => {
    const result = await withTransaction(async (tx) => {
      await tx.query("insert into it_ledger (note) values ('ok')");
      return "hecho";
    }, pool);

    expect(result).toBe("hecho");
    expect(await ledgerCount("ok")).toBe(1);
  });

  it("no deja nada si el servicio lanza después de escribir (todo o nada)", async () => {
    const boom = new Error("regla violada");

    await expect(
      withTransaction(async (tx) => {
        await tx.query("insert into it_ledger (note) values ('parcial')");
        await tx.query("insert into it_ledger (note) values ('parcial')");
        throw boom;
      }, pool),
    ).rejects.toBe(boom);

    expect(await ledgerCount("parcial")).toBe(0);
  });

  it("revierte también los cambios previos cuando la base rechaza una sentencia", async () => {
    await expect(
      withTransaction(async (tx) => {
        await tx.query("insert into it_ledger (note) values ('antes-del-error')");
        await tx.query("insert into it_ledger (note) values (null)");
      }, pool),
    ).rejects.toMatchObject({ code: "23502" }); // not_null_violation

    expect(await ledgerCount("antes-del-error")).toBe(0);
  });

  it("SELECT ... FOR UPDATE serializa transacciones concurrentes: no se pierden incrementos", async () => {
    await Promise.all([bump("row"), bump("row"), bump("row")]);

    expect(await counter()).toBe(3);
  });

  it("pg_advisory_xact_lock serializa transacciones concurrentes", async () => {
    await Promise.all([bump("advisory"), bump("advisory"), bump("advisory")]);

    expect(await counter()).toBe(3);
  });

  it("control negativo: sin bloqueo se pierden incrementos (por eso el bloqueo es obligatorio)", async () => {
    await Promise.all([bump("none"), bump("none"), bump("none")]);

    expect(await counter()).toBeLessThan(3);
  });
});
