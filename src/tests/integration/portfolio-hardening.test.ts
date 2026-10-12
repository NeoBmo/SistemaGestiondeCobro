import type pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { attempt, createTestPool, withRollback } from "./helpers/db";
import {
  createBusiness,
  createMainCashbox,
  createProfile,
  createSubscription,
} from "./helpers/identity";

// Endurecimiento de la cartera (F3-T2): calendario cronológico, interés según la fórmula, contrato y
// préstamo anulados juntos, número de contrato sin huecos ni repetidos, y barreras sobre clientes.

const pool = createTestPool();
afterAll(() => pool.end());

const CHECK_VIOLATION = "23514";
const RESTRICT_VIOLATION = "23001";

async function seed(client: pg.PoolClient) {
  const business = await createBusiness(client, "Negocio H");
  await createSubscription(client, business);
  await createMainCashbox(client, business);
  const admin = await createProfile(client, {
    role: "ADMIN_NEGOCIO",
    businessId: business,
    username: "admin.h",
  });
  const clientId = (
    await client.query<{ id: string }>(
      "insert into public.clients (business_id, name, identification, created_by) values ($1, 'Ana', '1', $2) returning id",
      [business, admin],
    )
  ).rows[0]!.id;
  return { business, admin, clientId };
}

type Seed = Awaited<ReturnType<typeof seed>>;

async function contract(client: pg.PoolClient, s: Seed, number = "CT-000001") {
  return (
    await client.query<{ id: string }>(
      "insert into public.contracts (business_id, client_id, number, origin, created_by) values ($1, $2, $3, 'NUEVO', $4) returning id",
      [s.business, s.clientId, number, s.admin],
    )
  ).rows[0]!.id;
}

const loanSql = `insert into public.loans
  (business_id, contract_id, principal_amount, interest_bps, interest_amount, total_amount,
   scheduled_amount, disbursed_on, first_due_on, frequency, installment_count, created_by)
  values ($1, $2, $3, $4, $5, $6, $6, '2026-10-13', '2026-10-14', 'DIARIA', 2, $7) returning id`;

async function loanWithInstallments(
  client: pg.PoolClient,
  s: Seed,
  contractId: string,
  dates: [string, string],
) {
  const loanId = (
    await client.query<{ id: string }>(loanSql, [s.business, contractId, 100, 0, 0, 100, s.admin])
  ).rows[0]!.id;
  for (const [index, due] of dates.entries()) {
    await client.query(
      "insert into public.installments (business_id, loan_id, number, due_on, amount) values ($1, $2, $3, $4, 50)",
      [s.business, loanId, index + 1, due],
    );
  }
  return loanId;
}

describe("calendario cronológico", () => {
  const check = (dates: [string, string]) =>
    withRollback(pool, async (client) => {
      const s = await seed(client);
      await loanWithInstallments(client, s, await contract(client, s), dates);
      return attempt(client, "set constraints all immediate");
    });

  it("exige que la cuota 1 venza en la primera fecha de cobro y que las fechas crezcan con el número", async () => {
    expect(await check(["2026-10-14", "2026-10-15"])).toBeNull();
    expect(
      (await check(["2026-10-15", "2026-10-16"]))?.constraint,
      "no empieza en first_due_on",
    ).toBe("loan_schedule_chronological");
    expect((await check(["2026-10-14", "2026-10-14"]))?.constraint, "fechas repetidas").toBe(
      "loan_schedule_chronological",
    );
    expect((await check(["2026-10-14", "2026-10-13"]))?.constraint, "cuota 2 antes que la 1").toBe(
      "loan_schedule_chronological",
    );
  });
});

describe("interés según la fórmula de 02 §2.4", () => {
  it("acepta el interés half-up de principal × bps / 10000 y rechaza cualquier otro", async () => {
    await withRollback(pool, async (client) => {
      const s = await seed(client);
      const insert = async (principal: number, bps: number, interest: number, number: string) => {
        const id = await contract(client, s, number);
        return attempt(client, loanSql, [
          s.business,
          id,
          principal,
          bps,
          interest,
          principal + interest,
          s.admin,
        ]);
      };

      expect(await insert(1_000_000, 2000, 200_000, "CT-000001")).toBeNull();
      expect(await insert(1001, 1250, 125, "CT-000002")).toBeNull(); // 125,125 → 125
      expect(await insert(10, 500, 1, "CT-000003")).toBeNull(); // 0,5 → 1 (half-up)
      expect((await insert(10, 500, 0, "CT-000004"))?.code).toBe(CHECK_VIOLATION);
      expect((await insert(1_000_000, 2000, 199_999, "CT-000005"))?.code).toBe(CHECK_VIOLATION);
      expect((await insert(1_000_000, 0, 5, "CT-000006"))?.code).toBe(CHECK_VIOLATION);
    });
  });
});

describe("contrato y préstamo", () => {
  it("un préstamo solo nace de un contrato confirmado", async () => {
    await withRollback(pool, async (client) => {
      const s = await seed(client);
      const id = await contract(client, s);
      await client.query(
        "update public.contracts set status = 'ANULADO', voided_by = $2, void_reason = 'Error' where id = $1",
        [id, s.admin],
      );

      const error = await attempt(client, loanSql, [s.business, id, 100, 0, 0, 100, s.admin]);

      expect(error?.code).toBe(CHECK_VIOLATION);
    });
  });

  it("se anulan juntos: anular uno solo se rechaza al confirmar, y anular ambos pasa", async () => {
    const voidParts = (which: "contract" | "loan" | "both") =>
      withRollback(pool, async (client) => {
        const s = await seed(client);
        const id = await contract(client, s);
        const loanId = await loanWithInstallments(client, s, id, ["2026-10-14", "2026-10-15"]);
        await client.query("set constraints all deferred");
        if (which !== "loan") {
          await client.query(
            "update public.contracts set status = 'ANULADO', voided_by = $2, void_reason = 'Error' where id = $1",
            [id, s.admin],
          );
        }
        if (which !== "contract") {
          await client.query("update public.loans set status = 'ANULADO' where id = $1", [loanId]);
        }
        return attempt(client, "set constraints all immediate");
      });

    expect((await voidParts("contract"))?.constraint).toBe("contract_loan_voided_together");
    expect((await voidParts("loan"))?.constraint).toBe("contract_loan_voided_together");
    expect(await voidParts("both")).toBeNull();
  });

  it("la fecha de anulación la fija la base y un contrato anulado no cambia ni su autor ni su fecha", async () => {
    await withRollback(pool, async (client) => {
      const s = await seed(client);
      const id = await contract(client, s);

      await client.query(
        "update public.contracts set status = 'ANULADO', voided_at = '2000-01-01', voided_by = $2, void_reason = 'Error' where id = $1",
        [id, s.admin],
      );
      const { rows } = await client.query<{ recent: boolean }>(
        "select voided_at > now() - interval '1 minute' as recent from public.contracts where id = $1",
        [id],
      );
      expect(rows[0]!.recent).toBe(true);
      for (const statement of [
        "update public.contracts set voided_at = now() + interval '1 day' where id = $1",
        "update public.contracts set voided_by = null where id = $1",
      ]) {
        expect((await attempt(client, statement, [id]))?.code, statement).toBe(RESTRICT_VIOLATION);
      }
    });
  });

  it("un UPDATE que no cambia nada se tolera en un contrato confirmado", async () => {
    await withRollback(pool, async (client) => {
      const s = await seed(client);
      const id = await contract(client, s);
      expect(
        await attempt(client, "update public.contracts set comment = comment where id = $1", [id]),
      ).toBeNull();
    });
  });
});

describe("número de contrato", () => {
  const next = (client: pg.PoolClient, business: string) =>
    client
      .query<{ n: string }>("select private.next_contract_number($1) as n", [business])
      .then((result) => result.rows[0]!.n);

  it("es secuencial por negocio con formato CT-000001 y no se consume al revertir", async () => {
    await withRollback(pool, async (client) => {
      const s = await seed(client);
      expect(await next(client, s.business)).toBe("CT-000001");
      expect(await next(client, s.business)).toBe("CT-000002");
      await client.query("savepoint s1");
      expect(await next(client, s.business)).toBe("CT-000003");
      await client.query("rollback to savepoint s1");
      expect(await next(client, s.business)).toBe("CT-000003");
    });
  });

  it("dos confirmaciones simultáneas del mismo negocio reciben números distintos y sin huecos", async () => {
    const setup = await pool.connect();
    let business = "";
    let admin = "";
    try {
      await setup.query("begin");
      const s = await seed(setup);
      business = s.business;
      admin = s.admin;
      await setup.query("commit");
    } finally {
      setup.release();
    }

    const take = async (): Promise<string> => {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const number = await next(client, business);
        await new Promise((resolve) => setTimeout(resolve, 200));
        await client.query("commit");
        return number;
      } finally {
        client.release();
      }
    };

    try {
      const numbers = await Promise.all([take(), take(), take()]);
      expect([...numbers].sort()).toEqual(["CT-000001", "CT-000002", "CT-000003"]);
    } finally {
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query("alter table public.main_cashboxes disable trigger append_only_row");
        await client.query("alter table public.clients disable trigger clients_protect_identity");
        await client.query("delete from public.contract_counters where business_id = $1", [
          business,
        ]);
        await client.query("delete from public.clients where business_id = $1", [business]);
        await client.query("delete from public.main_cashboxes where business_id = $1", [business]);
        await client.query("alter table public.main_cashboxes enable trigger append_only_row");
        await client.query("alter table public.clients enable trigger clients_protect_identity");
        await client.query("delete from public.subscriptions where business_id = $1", [business]);
        await client.query("delete from public.profiles where id = $1", [admin]);
        await client.query("delete from auth.users where id = $1", [admin]);
        await client.query("delete from public.businesses where id = $1", [business]);
        await client.query("commit");
      } finally {
        client.release();
      }
    }
  });

  it("la tabla del contador y la función no son accesibles por la API de datos", async () => {
    await withRollback(pool, async (client) => {
      for (const role of ["anon", "authenticated"]) {
        await client.query(`set local role ${role}`);
        expect((await attempt(client, "select * from public.contract_counters"))?.code, role).toBe(
          "42501",
        );
        expect(
          (await attempt(client, "select private.next_contract_number(gen_random_uuid())"))?.code,
          role,
        ).toBe("42501");
        await client.query("reset role");
      }
    });
  });
});

describe("clientes", () => {
  it("la identificación no admite espacios en los extremos y TRUNCATE se rechaza", async () => {
    await withRollback(pool, async (client) => {
      const s = await seed(client);
      expect(
        (
          await attempt(
            client,
            "insert into public.clients (business_id, name, identification, created_by) values ($1, 'B', ' 2 ', $2)",
            [s.business, s.admin],
          )
        )?.code,
      ).toBe(CHECK_VIOLATION);
      expect(
        (await attempt(client, "update public.clients set name = '  ' where id = $1", [s.clientId]))
          ?.code,
      ).toBe(CHECK_VIOLATION);
      for (const table of ["clients", "installments", "loans", "contracts"]) {
        const error = await attempt(client, `truncate public.${table}`);
        expect(["23001", "0A000"], table).toContain(error?.code);
      }
    });
  });
});
