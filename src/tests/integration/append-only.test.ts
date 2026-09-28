import type pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { attempt, createTestPool, withRollback } from "./helpers/db";

// 03-ARQUITECTURA §4 punto 8 y 02-DOMINIO §9 invariante 10: los hechos financieros no se editan ni se borran.

const pool = createTestPool();
afterAll(() => pool.end());

const API_ROLES = ["anon", "authenticated", "service_role"];
const RESTRICT_VIOLATION = "23001";
const INSUFFICIENT_PRIVILEGE = "42501";

async function createFactTable(client: pg.PoolClient, allowedColumns: string[] = []) {
  await client.query(
    "create table it_fact (id int primary key, amount bigint not null, balance bigint not null default 0)",
  );
  await client.query("select private.make_append_only('it_fact', $1::text[])", [allowedColumns]);
  await client.query("insert into it_fact (id, amount) values (1, 1000)");
}

describe("private.make_append_only", () => {
  it("permite INSERT y rechaza UPDATE, DELETE y TRUNCATE dejando la fila intacta", async () => {
    await withRollback(pool, async (client) => {
      await createFactTable(client);

      expect(await attempt(client, "insert into it_fact (id, amount) values (2, 500)")).toBeNull();

      for (const statement of [
        "update it_fact set amount = 2000 where id = 1",
        "delete from it_fact where id = 1",
        "truncate it_fact",
      ]) {
        const error = await attempt(client, statement);
        expect(error?.code, statement).toBe(RESTRICT_VIOLATION);
        expect(error?.message, statement).toContain("solo agregado");
      }

      const { rows } = await client.query("select id, amount::text from it_fact order by id");
      expect(rows).toEqual([
        { id: 1, amount: "1000" },
        { id: 2, amount: "500" },
      ]);
    });
  });

  it("solo permite modificar las columnas derivadas declaradas", async () => {
    await withRollback(pool, async (client) => {
      await createFactTable(client, ["balance"]);

      expect(await attempt(client, "update it_fact set balance = 400 where id = 1")).toBeNull();
      expect((await attempt(client, "update it_fact set amount = 1 where id = 1"))?.code).toBe(
        RESTRICT_VIOLATION,
      );
      expect(
        (await attempt(client, "update it_fact set balance = 1, amount = 1 where id = 1"))?.code,
      ).toBe(RESTRICT_VIOLATION);
      expect((await attempt(client, "delete from it_fact where id = 1"))?.code).toBe(
        RESTRICT_VIOLATION,
      );

      const { rows } = await client.query("select amount::text, balance::text from it_fact");
      expect(rows).toEqual([{ amount: "1000", balance: "400" }]);
    });
  });

  it("tolera un UPDATE que no cambia ningún valor", async () => {
    await withRollback(pool, async (client) => {
      await createFactTable(client);

      expect(await attempt(client, "update it_fact set amount = amount where id = 1")).toBeNull();
    });
  });

  it("revoca UPDATE, DELETE y TRUNCATE a los roles de la API", async () => {
    await withRollback(pool, async (client) => {
      await createFactTable(client);

      for (const role of API_ROLES) {
        for (const privilege of ["UPDATE", "DELETE", "TRUNCATE"]) {
          const { rows } = await client.query<{ allowed: boolean }>(
            "select has_table_privilege($1, 'it_fact', $2) as allowed",
            [role, privilege],
          );
          expect(rows[0]?.allowed, `${role} ${privilege}`).toBe(false);
        }
      }
    });
  });

  it("los roles de la API reciben permission denied antes de llegar al trigger", async () => {
    await withRollback(pool, async (client) => {
      await createFactTable(client);
      await client.query("set local role authenticated");

      expect((await attempt(client, "update it_fact set amount = 1 where id = 1"))?.code).toBe(
        INSUFFICIENT_PRIVILEGE,
      );
      expect((await attempt(client, "delete from it_fact where id = 1"))?.code).toBe(
        INSUFFICIENT_PRIVILEGE,
      );

      await client.query("reset role");
    });
  });

  it("el DDL de prueba no deja rastro tras el rollback", async () => {
    await withRollback(pool, async (client) => {
      await createFactTable(client);
    });

    const { rows } = await pool.query("select to_regclass('it_fact')::text as table_name");
    expect(rows[0]?.table_name).toBeNull();
  });
});
