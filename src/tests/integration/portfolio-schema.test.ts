import type pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { attempt, createTestPool, withRollback } from "./helpers/db";
import {
  asApiUser,
  createBusiness,
  createMainCashbox,
  createProfile,
  createSubscription,
  resetApiUser,
} from "./helpers/identity";

// 02 §2.1–2.4 y §9, ADR 0007: clientes únicos por negocio, contrato inmutable salvo su anulación,
// un préstamo por contrato, cuotas que suman el calendario y aislamiento entre negocios.

const pool = createTestPool();
afterAll(() => pool.end());

const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";
const RESTRICT_VIOLATION = "23001";

type Seed = Awaited<ReturnType<typeof seed>>;

async function seed(client: pg.PoolClient) {
  const a = await createBusiness(client, "Negocio A");
  const b = await createBusiness(client, "Negocio B");
  await createSubscription(client, a);
  await createSubscription(client, b);
  await createMainCashbox(client, a);
  await createMainCashbox(client, b);
  const adminA = await createProfile(client, {
    role: "ADMIN_NEGOCIO",
    businessId: a,
    username: "admin.a",
  });
  const adminB = await createProfile(client, {
    role: "ADMIN_NEGOCIO",
    businessId: b,
    username: "admin.b",
  });
  return { a, b, adminA, adminB };
}

async function insertClient(
  client: pg.PoolClient,
  s: Seed,
  fields: { business?: string; identification?: string; name?: string } = {},
): Promise<string> {
  const business = fields.business ?? s.a;
  const { rows } = await client.query<{ id: string }>(
    `insert into public.clients (business_id, name, identification, created_by)
     values ($1, $2, $3, $4) returning id`,
    [
      business,
      fields.name ?? "Cliente de prueba",
      fields.identification ?? "100200300",
      business === s.b ? s.adminB : s.adminA,
    ],
  );
  return rows[0]!.id;
}

async function insertContract(
  client: pg.PoolClient,
  s: Seed,
  clientId: string,
  number = "CT-000001",
  business = s.a,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into public.contracts (business_id, client_id, number, origin, created_by)
     values ($1, $2, $3, 'NUEVO', $4) returning id`,
    [business, clientId, number, business === s.b ? s.adminB : s.adminA],
  );
  return rows[0]!.id;
}

async function insertLoan(
  client: pg.PoolClient,
  s: Seed,
  contractId: string,
  overrides: Partial<{ total: number; scheduled: number; count: number }> = {},
): Promise<string> {
  const total = overrides.total ?? 1_200_000;
  const { rows } = await client.query<{ id: string }>(
    `insert into public.loans
       (business_id, contract_id, principal_amount, interest_bps, interest_amount, total_amount,
        scheduled_amount, disbursed_on, first_due_on, frequency, installment_count, created_by)
     values ($1, $2, $3, 0, 0, $3, $4, '2026-10-13', '2026-10-14', 'DIARIA', $5, $6)
     returning id`,
    [s.a, contractId, total, overrides.scheduled ?? total, overrides.count ?? 12, s.adminA],
  );
  return rows[0]!.id;
}

async function insertInstallments(
  client: pg.PoolClient,
  s: Seed,
  loanId: string,
  amounts: number[],
): Promise<void> {
  for (const [index, amount] of amounts.entries()) {
    await client.query(
      `insert into public.installments (business_id, loan_id, number, due_on, amount)
       values ($1, $2, $3, date '2026-10-14' + ($3::int - 1), $4)`,
      [s.a, loanId, index + 1, amount],
    );
  }
}

describe("clientes", () => {
  it("la identificación es única por negocio, pero el mismo documento puede estar en otro negocio", async () => {
    await withRollback(pool, async (client) => {
      const s = await seed(client);
      await insertClient(client, s, { identification: "123" });

      const duplicate = await attempt(
        client,
        "insert into public.clients (business_id, name, identification, created_by) values ($1, 'Otro', '123', $2)",
        [s.a, s.adminA],
      );
      expect(duplicate?.code).toBe(UNIQUE_VIOLATION);

      expect(await insertClient(client, s, { business: s.b, identification: "123" })).toBeTruthy();
    });
  });

  // 02 §2.1 (decisión del 2026-10-24): un cliente con contratos no se elimina; sin ellos, sí.
  it("el contacto se edita, pero no la identificación, el negocio ni el origen; con contratos no se elimina", async () => {
    await withRollback(pool, async (client) => {
      const s = await seed(client);
      const id = await insertClient(client, s);
      await insertContract(client, s, id);

      expect(
        await attempt(
          client,
          "update public.clients set phone = '3001112233', name = 'Nuevo' where id = $1",
          [id],
        ),
      ).toBeNull();
      for (const statement of [
        "update public.clients set identification = '999' where id = $1",
        "update public.clients set business_id = (select id from public.businesses where name = 'Negocio B') where id = $1",
        "update public.clients set created_by = created_by, created_at = now() - interval '1 day' where id = $1",
        "delete from public.clients where id = $1",
      ]) {
        expect((await attempt(client, statement, [id]))?.code, statement).toBe(RESTRICT_VIOLATION);
      }

      const withoutHistory = await insertClient(client, s, { identification: "sin-historial" });
      expect(
        await attempt(client, "delete from public.clients where id = $1", [withoutHistory]),
      ).toBeNull();
    });
  });

  it("rechaza nombre o identificación vacíos y un autor de otro negocio", async () => {
    await withRollback(pool, async (client) => {
      const s = await seed(client);
      const insert = (name: string, identification: string, author: string) =>
        attempt(
          client,
          "insert into public.clients (business_id, name, identification, created_by) values ($1, $2, $3, $4)",
          [s.a, name, identification, author],
        );

      expect((await insert("  ", "1", s.adminA))?.code).toBe(CHECK_VIOLATION);
      expect((await insert("Ana", "  ", s.adminA))?.code).toBe(CHECK_VIOLATION);
      expect((await insert("Ana", "1", s.adminB))?.code).toBe(FOREIGN_KEY_VIOLATION);
    });
  });
});

describe("contratos", () => {
  it("el número es único por negocio y tiene formato CT-000000", async () => {
    await withRollback(pool, async (client) => {
      const s = await seed(client);
      const clientA = await insertClient(client, s);
      await insertContract(client, s, clientA, "CT-000001");

      const repeated = await attempt(
        client,
        "insert into public.contracts (business_id, client_id, number, origin, created_by) values ($1, $2, 'CT-000001', 'NUEVO', $3)",
        [s.a, clientA, s.adminA],
      );
      expect(repeated?.code).toBe(UNIQUE_VIOLATION);
      const badFormat = await attempt(
        client,
        "insert into public.contracts (business_id, client_id, number, origin, created_by) values ($1, $2, 'C-1', 'NUEVO', $3)",
        [s.a, clientA, s.adminA],
      );
      expect(badFormat?.code).toBe(CHECK_VIOLATION);

      const clientB = await insertClient(client, s, { business: s.b });
      expect(await insertContract(client, s, clientB, "CT-000001", s.b)).toBeTruthy();
    });
  });

  it("un contrato no puede apuntar al cliente de otro negocio", async () => {
    await withRollback(pool, async (client) => {
      const s = await seed(client);
      const foreignClient = await insertClient(client, s, { business: s.b });

      const error = await attempt(
        client,
        "insert into public.contracts (business_id, client_id, number, origin, created_by) values ($1, $2, 'CT-000001', 'NUEVO', $3)",
        [s.a, foreignClient, s.adminA],
      );

      expect(error?.code).toBe(FOREIGN_KEY_VIOLATION);
    });
  });

  it("es inmutable: solo se anula (con motivo, fecha y autor), una vez, y no se elimina", async () => {
    await withRollback(pool, async (client) => {
      const s = await seed(client);
      const id = await insertContract(client, s, await insertClient(client, s));

      for (const statement of [
        "update public.contracts set number = 'CT-000002' where id = $1",
        "update public.contracts set comment = 'editado' where id = $1",
        "update public.contracts set client_id = client_id, origin = 'IMPORTADO' where id = $1",
        "delete from public.contracts where id = $1",
        "truncate public.contracts",
      ]) {
        const error = await attempt(
          client,
          statement,
          [id].slice(0, statement.includes("$1") ? 1 : 0),
        );
        expect(["23001", "0A000"], statement).toContain(error?.code);
      }

      // Anular sin motivo o sin autor se rechaza; completo, se acepta una sola vez.
      expect(
        (
          await attempt(
            client,
            "update public.contracts set status = 'ANULADO', voided_at = now() where id = $1",
            [id],
          )
        )?.code,
      ).toBe(CHECK_VIOLATION);
      expect(
        await attempt(
          client,
          "update public.contracts set status = 'ANULADO', voided_at = now(), voided_by = $2, void_reason = 'Error del cliente' where id = $1",
          [id, s.adminA],
        ),
      ).toBeNull();
      expect(
        (
          await attempt(
            client,
            "update public.contracts set void_reason = 'otro motivo' where id = $1",
            [id],
          )
        )?.code,
      ).toBe(RESTRICT_VIOLATION);
      expect(
        (
          await attempt(client, "update public.contracts set status = 'CONFIRMADO' where id = $1", [
            id,
          ])
        )?.code,
      ).toBe(RESTRICT_VIOLATION);
    });
  });
});

describe("préstamos y cuotas", () => {
  async function newContract(client: pg.PoolClient, s: Seed) {
    return insertContract(client, s, await insertClient(client, s));
  }

  it("un contrato tiene un solo préstamo y los importes son coherentes", async () => {
    await withRollback(pool, async (client) => {
      const s = await seed(client);
      const contractId = await newContract(client, s);
      await client.query("set constraints all deferred");
      await insertLoan(client, s, contractId);

      const second = await attempt(
        client,
        `insert into public.loans
           (business_id, contract_id, principal_amount, interest_bps, interest_amount, total_amount,
            scheduled_amount, disbursed_on, first_due_on, frequency, installment_count, created_by)
         values ($1, $2, 1000, 0, 0, 1000, 1000, '2026-10-13', '2026-10-14', 'DIARIA', 1, $3)`,
        [s.a, contractId, s.adminA],
      );
      expect(second?.code).toBe(UNIQUE_VIOLATION);

      // total ≠ principal + interés, o calendario mayor que el total: rechazados por el esquema.
      const otherContract = await insertContract(
        client,
        s,
        await insertClient(client, s, { identification: "otro" }),
        "CT-000002",
      );
      const insertBad = (total: number, scheduled: number) =>
        attempt(
          client,
          `insert into public.loans
             (business_id, contract_id, principal_amount, interest_bps, interest_amount, total_amount,
              scheduled_amount, disbursed_on, first_due_on, frequency, installment_count, created_by)
           values ($1, $2, 1000, 2000, 200, $3, $4, '2026-10-13', '2026-10-14', 'DIARIA', 1, $5)`,
          [s.a, otherContract, total, scheduled, s.adminA],
        );
      expect((await insertBad(1300, 1300))?.code, "total incoherente").toBe(CHECK_VIOLATION);
      expect((await insertBad(1200, 1201))?.code, "calendario mayor que el total").toBe(
        CHECK_VIOLATION,
      );
    });
  });

  it("al confirmar, las cuotas deben sumar el calendario y estar numeradas de 1 a n", async () => {
    // Las comprobaciones son diferidas: se fuerzan con SET CONSTRAINTS dentro de una transacción
    // que siempre se revierte, así la prueba no deja datos.
    const run = async (amounts: number[], count = amounts.length) =>
      withRollback(pool, async (client) => {
        const s = await seed(client);
        const loanId = await insertLoan(
          client,
          s,
          await insertContract(client, s, await insertClient(client, s)),
          { total: 300, count },
        );
        await insertInstallments(client, s, loanId, amounts);
        return attempt(client, "set constraints all immediate");
      });

    expect(await run([100, 100, 100])).toBeNull();
    expect((await run([100, 100, 99]))?.constraint).toBe("loan_schedule_consistent");
    expect((await run([100, 100, 100, 1], 3))?.constraint).toBe("loan_schedule_consistent");
    expect((await run([150, 150], 3))?.constraint).toBe("loan_schedule_consistent");
    expect((await run([], 3))?.constraint).toBe("loan_schedule_consistent");
  });

  it("las cuotas son de solo agregado y de valor positivo; una cuota no cruza de negocio", async () => {
    await withRollback(pool, async (client) => {
      const s = await seed(client);
      const loanId = await insertLoan(
        client,
        s,
        await insertContract(client, s, await insertClient(client, s)),
        { total: 200, count: 2 },
      );
      await insertInstallments(client, s, loanId, [100, 100]);

      await client.query("set constraints all immediate");
      for (const statement of [
        "update public.installments set amount = 1",
        "delete from public.installments",
      ]) {
        expect((await attempt(client, statement))?.code, statement).toBe(RESTRICT_VIOLATION);
      }
      expect(
        (
          await attempt(
            client,
            "insert into public.installments (business_id, loan_id, number, due_on, amount) values ($1, $2, 3, '2026-11-01', 0)",
            [s.a, loanId],
          )
        )?.code,
      ).toBe(CHECK_VIOLATION);
      expect(
        (
          await attempt(
            client,
            "insert into public.installments (business_id, loan_id, number, due_on, amount) values ($1, $2, 3, '2026-11-01', 5)",
            [s.b, loanId],
          )
        )?.code,
      ).toBe(FOREIGN_KEY_VIOLATION);
    });
  });

  it("el préstamo no cambia sus importes y solo pasa de ACTIVO a ANULADO", async () => {
    await withRollback(pool, async (client) => {
      const s = await seed(client);
      const loanId = await insertLoan(
        client,
        s,
        await insertContract(client, s, await insertClient(client, s)),
        { total: 100, count: 1 },
      );
      await insertInstallments(client, s, loanId, [100]);
      await client.query("set constraints all immediate");

      for (const statement of [
        "update public.loans set principal_amount = 1 where id = $1",
        "update public.loans set total_amount = total_amount + 1 where id = $1",
        "update public.loans set first_due_on = '2030-01-01' where id = $1",
        "delete from public.loans where id = $1",
      ]) {
        expect((await attempt(client, statement, [loanId]))?.code, statement).toBe(
          RESTRICT_VIOLATION,
        );
        // Anular el préstamo sin su contrato lo rechaza la restricción diferida; aquí solo se prueba la transición.
        await client.query("set constraints all deferred");
      }
      expect(
        await attempt(client, "update public.loans set status = 'ANULADO' where id = $1", [loanId]),
      ).toBeNull();
      expect(
        (await attempt(client, "update public.loans set status = 'ACTIVO' where id = $1", [loanId]))
          ?.code,
      ).toBe(RESTRICT_VIOLATION);
    });
  });
});

describe("RLS de la cartera", () => {
  it("el Admin de A ve solo su cartera; el cobrador y el Super Admin no la leen; nadie escribe por la API", async () => {
    await withRollback(pool, async (client) => {
      const s = await seed(client);
      const clientA = await insertClient(client, s, { identification: "A1" });
      await insertClient(client, s, { business: s.b, identification: "B1" });
      const contractId = await insertContract(client, s, clientA);
      const loanId = await insertLoan(client, s, contractId, { total: 100, count: 1 });
      await insertInstallments(client, s, loanId, [100]);
      const collector = await createProfile(client, {
        role: "COBRADOR",
        businessId: s.a,
        username: "cobrador.a",
      });
      const superAdmin = await createProfile(client, {
        role: "SUPER_ADMIN",
        businessId: null,
        username: "root.admin",
      });
      const count = async (table: string) =>
        (await client.query<{ n: string }>(`select count(*) as n from public.${table}`)).rows[0]!.n;

      await asApiUser(client, { sub: s.adminA, app_role: "ADMIN_NEGOCIO", business_id: s.a });
      expect(await count("clients")).toBe("1");
      for (const table of ["contracts", "loans", "installments"]) {
        expect(await count(table), table).toBe("1");
      }
      for (const statement of [
        "insert into public.clients (business_id, name, identification, created_by) values (gen_random_uuid(), 'x', 'y', gen_random_uuid())",
        "update public.clients set name = 'x'",
        "delete from public.loans",
        "select * from public.contract_counters",
      ]) {
        expect((await attempt(client, statement))?.code, statement).toBe("42501");
      }
      await resetApiUser(client);

      await asApiUser(client, { sub: collector, app_role: "COBRADOR", business_id: s.a });
      for (const table of ["clients", "contracts", "loans", "installments"]) {
        expect(await count(table), table).toBe("0");
      }
      await resetApiUser(client);
      await asApiUser(client, { sub: superAdmin, app_role: "SUPER_ADMIN", business_id: null });
      for (const table of ["clients", "contracts", "loans", "installments"]) {
        expect(await count(table), table).toBe("0");
      }
    });
  });
});
