import type pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { attempt, createTestPool, sleep, withRollback } from "./helpers/db";
import {
  asApiUser,
  createBusiness,
  createMainCashbox,
  createProfile,
  createSubscription,
  resetApiUser,
} from "./helpers/identity";

// ADR 0006 y 02 §5.3/§9: el libro de Caja Mayor es de solo agregado, no admite un saldo negativo y
// solo el Admin de su propio negocio (con sesión y negocio activos) lo lee por la API de datos.

const pool = createTestPool();
afterAll(() => pool.end());

const RESTRICT_VIOLATION = "23001";
const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

type Seed = Awaited<ReturnType<typeof seed>>;

async function seed(client: pg.PoolClient) {
  const a = await createBusiness(client, "Negocio A");
  const b = await createBusiness(client, "Negocio B");
  await createSubscription(client, a);
  await createSubscription(client, b);
  const boxA = await createMainCashbox(client, a);
  const boxB = await createMainCashbox(client, b);
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
  return { a, b, boxA, boxB, adminA, adminB };
}

async function movement(
  client: pg.PoolClient,
  s: Seed,
  fields: {
    type: string;
    direction: string;
    amount?: number;
    reason?: string | null;
    reverses?: string | null;
    business?: string;
    box?: string;
  },
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into public.cash_movements
       (business_id, cashbox_id, type, direction, amount, reason, reverses_movement_id, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [
      fields.business ?? s.a,
      fields.box ?? s.boxA,
      fields.type,
      fields.direction,
      fields.amount ?? 1000,
      fields.reason ?? null,
      fields.reverses ?? null,
      (fields.business ?? s.a) === s.b ? s.adminB : s.adminA,
    ],
  );
  return rows[0]!.id;
}

/** Borra lo que una prueba confirmó de verdad (el libro es de solo agregado: se suspende el trigger solo aquí). */
async function cleanup(s: Seed): Promise<void> {
  const client = await pool.connect();
  const ledger = ["expenses", "cash_movements", "idempotency_keys", "main_cashboxes"];
  try {
    await client.query("begin");
    for (const table of ledger) {
      await client.query(`alter table public.${table} disable trigger append_only_row`);
    }
    const businesses = [s.a, s.b];
    await client.query("delete from public.expenses where business_id = any($1)", [businesses]);
    await client.query("delete from public.cash_movements where business_id = any($1)", [
      businesses,
    ]);
    await client.query("delete from public.idempotency_keys where business_id = any($1)", [
      businesses,
    ]);
    await client.query("delete from public.main_cashboxes where business_id = any($1)", [
      businesses,
    ]);
    for (const table of ledger) {
      await client.query(`alter table public.${table} enable trigger append_only_row`);
    }
    await client.query("delete from public.subscriptions where business_id = any($1)", [
      businesses,
    ]);
    await client.query("delete from public.profiles where business_id = any($1)", [businesses]);
    await client.query("delete from auth.users where id = any($1)", [[s.adminA, s.adminB]]);
    await client.query("delete from public.businesses where id = any($1)", [businesses]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/** Ingreso de 5000 y un gasto de 1000 de Caja Mayor: devuelve el movimiento del gasto. */
async function spendOne(client: pg.PoolClient, s: Seed): Promise<string> {
  await movement(client, s, { type: "INGRESO_CAPITAL", direction: "ENTRADA", amount: 5000 });
  return movement(client, s, { type: "GASTO_CAJA_MAYOR", direction: "SALIDA", amount: 1000 });
}

const tryMovement = async (
  client: pg.PoolClient,
  s: Seed,
  fields: Parameters<typeof movement>[2],
) => {
  await client.query("savepoint m");
  try {
    await movement(client, s, fields);
    await client.query("release savepoint m");
    return null;
  } catch (error) {
    await client.query("rollback to savepoint m");
    return error as pg.DatabaseError;
  }
};

describe("solo agregado", () => {
  it("el libro no admite UPDATE, DELETE ni TRUNCATE (idempotency_keys solo completa `result`)", async () => {
    await withRollback(pool, async (client) => {
      const s = await seed(client);
      const id = await spendOne(client, s);
      await client.query(
        `insert into public.expenses (business_id, cashbox_id, movement_id, category, amount, spent_on, created_by)
         values ($1, $2, $3, 'GASOLINA', 1000, current_date, $4)`,
        [s.a, s.boxA, id, s.adminA],
      );
      await client.query(
        "insert into public.idempotency_keys (business_id, command, key, payload_hash) values ($1, 'x', gen_random_uuid(), 'h')",
        [s.a],
      );

      // Vacía los eventos diferidos (saldo): PostgreSQL no permite TRUNCATE con eventos pendientes.
      await client.query("set constraints all immediate");
      for (const statement of [
        "update public.cash_movements set amount = 1",
        "delete from public.cash_movements",
        "truncate public.cash_movements",
        "update public.expenses set amount = 1",
        "delete from public.expenses",
        "update public.main_cashboxes set business_id = business_id",
        "delete from public.main_cashboxes",
        "update public.idempotency_keys set payload_hash = 'otro'",
        "delete from public.idempotency_keys",
      ]) {
        const error = await attempt(client, statement);
        // Un UPDATE que no cambia nada se tolera; el resto debe fallar.
        if (statement.includes("business_id = business_id")) continue;
        // TRUNCATE de una tabla con claves foráneas entrantes ya lo rechaza PostgreSQL (0A000) antes del trigger.
        const expected = statement.startsWith("truncate")
          ? [RESTRICT_VIOLATION, "0A000"]
          : [RESTRICT_VIOLATION];
        expect(expected, statement).toContain(error?.code);
      }

      expect(
        await attempt(client, "update public.idempotency_keys set result = '{\"ok\":true}'"),
      ).toBeNull();
    });
  });
});

describe("integridad de movimientos", () => {
  it("rechaza importes no positivos, direcciones incoherentes con el tipo y ajustes sin motivo", async () => {
    await withRollback(pool, async (client) => {
      const s = await seed(client);
      const rejected = [
        { type: "INGRESO_CAPITAL", direction: "ENTRADA", amount: 0 },
        { type: "INGRESO_CAPITAL", direction: "ENTRADA", amount: -5 },
        { type: "INGRESO_CAPITAL", direction: "SALIDA" },
        { type: "GASTO_CAJA_MAYOR", direction: "ENTRADA" },
        { type: "AJUSTE", direction: "ENTRADA" },
        { type: "AJUSTE", direction: "ENTRADA", reason: "   " },
        { type: "TIPO_INVENTADO", direction: "ENTRADA" },
      ];
      for (const fields of rejected) {
        const error = await tryMovement(client, s, fields);
        expect(error?.code, JSON.stringify(fields)).toBe(CHECK_VIOLATION);
      }
      expect(
        await tryMovement(client, s, {
          type: "AJUSTE",
          direction: "SALIDA",
          reason: "Corrección",
        }),
      ).toBeNull();
    });
  });

  it("un negocio solo registra un saldo de apertura, y es de su propia caja", async () => {
    await withRollback(pool, async (client) => {
      const s = await seed(client);
      await movement(client, s, { type: "SALDO_APERTURA", direction: "ENTRADA" });

      const second = await tryMovement(client, s, { type: "SALDO_APERTURA", direction: "ENTRADA" });
      expect(second?.code).toBe(UNIQUE_VIOLATION);

      // El otro negocio puede tener el suyo, pero no se puede usar la caja de otro negocio.
      expect(
        await tryMovement(client, s, {
          type: "SALDO_APERTURA",
          direction: "ENTRADA",
          business: s.b,
          box: s.boxB,
        }),
      ).toBeNull();
      const crossed = await tryMovement(client, s, {
        type: "INGRESO_CAPITAL",
        direction: "ENTRADA",
        business: s.a,
        box: s.boxB,
      });
      expect(crossed?.code).toBe(FOREIGN_KEY_VIOLATION);
    });
  });

  it("un reverso anula por completo un movimiento, una sola vez, y no se reversa un reverso", async () => {
    await withRollback(pool, async (client) => {
      const s = await seed(client);
      const income = await movement(client, s, { type: "INGRESO_CAPITAL", direction: "ENTRADA" });

      const reverse = (fields: Partial<Parameters<typeof movement>[2]>) =>
        tryMovement(client, s, {
          type: "REVERSO",
          direction: "SALIDA",
          reason: "Error de digitación",
          reverses: income,
          ...fields,
        });

      expect((await reverse({ amount: 999 }))?.code, "otro importe").toBe(CHECK_VIOLATION);
      expect((await reverse({ direction: "ENTRADA" }))?.code, "misma dirección").toBe(
        CHECK_VIOLATION,
      );
      expect((await reverse({ reason: null }))?.code, "sin motivo").toBe(CHECK_VIOLATION);
      expect(
        (await tryMovement(client, s, { type: "REVERSO", direction: "SALIDA", reason: "x" }))?.code,
        "reverso sin original",
      ).toBe(CHECK_VIOLATION);
      expect(
        (
          await tryMovement(client, s, {
            type: "INGRESO_CAPITAL",
            direction: "ENTRADA",
            reverses: income,
          })
        )?.code,
        "solo un REVERSO referencia",
      ).toBe(CHECK_VIOLATION);

      expect(await reverse({})).toBeNull();
      expect((await reverse({}))?.code, "segundo reverso").toBe(UNIQUE_VIOLATION);

      const { rows } = await client.query<{ id: string }>(
        "select id from public.cash_movements where type = 'REVERSO'",
      );
      const again = await tryMovement(client, s, {
        type: "REVERSO",
        direction: "ENTRADA",
        reason: "Reversar el reverso",
        reverses: rows[0]!.id,
      });
      expect(again?.code, "reverso de un reverso").toBe(CHECK_VIOLATION);
    });
  });

  it("el saldo de la Caja Mayor nunca queda negativo (barrera de base de datos, al confirmar)", async () => {
    await withRollback(pool, async (client) => {
      const s = await seed(client);
      await movement(client, s, { type: "INGRESO_CAPITAL", direction: "ENTRADA", amount: 1000 });

      // Las restricciones diferidas se comprueban al confirmar; se fuerzan aquí sin confirmar.
      await client.query("set constraints cash_movements_balance_not_negative immediate");
      const over = await tryMovement(client, s, {
        type: "GASTO_CAJA_MAYOR",
        direction: "SALIDA",
        amount: 1001,
      });
      expect(over?.code).toBe(CHECK_VIOLATION);
      expect(over?.constraint).toBe("cashbox_balance_not_negative");

      expect(
        await tryMovement(client, s, {
          type: "GASTO_CAJA_MAYOR",
          direction: "SALIDA",
          amount: 1000,
        }),
      ).toBeNull();
    });
  });
});

describe("gastos", () => {
  it("la categoría OTRO exige observación y un movimiento tiene un solo gasto", async () => {
    await withRollback(pool, async (client) => {
      const s = await seed(client);
      const id = await spendOne(client, s);
      const insert = (category: string, note: string | null) =>
        attempt(
          client,
          `insert into public.expenses (business_id, cashbox_id, movement_id, category, amount, spent_on, note, created_by)
           values ($1, $2, $3, $4, 1000, current_date, $5, $6)`,
          [s.a, s.boxA, id, category, note, s.adminA],
        );

      expect((await insert("OTRO", null))?.code).toBe(CHECK_VIOLATION);
      expect((await insert("OTRO", "  "))?.code).toBe(CHECK_VIOLATION);
      expect((await insert("VIAJES", null))?.code).toBe(CHECK_VIOLATION);
      expect(await insert("OTRO", "Papelería")).toBeNull();
      expect((await insert("GASOLINA", null))?.code).toBe(UNIQUE_VIOLATION);
    });
  });
});

describe("coherencia gasto ↔ movimiento y autoría", () => {
  it("un gasto debe coincidir con un movimiento GASTO_CAJA_MAYOR del mismo importe", async () => {
    await withRollback(pool, async (client) => {
      const s = await seed(client);
      const income = await movement(client, s, {
        type: "INGRESO_CAPITAL",
        direction: "ENTRADA",
        amount: 5000,
      });
      const spend = await movement(client, s, {
        type: "GASTO_CAJA_MAYOR",
        direction: "SALIDA",
        amount: 1000,
      });
      const insert = (movementId: string, amount: number) =>
        attempt(
          client,
          `insert into public.expenses (business_id, cashbox_id, movement_id, category, amount, spent_on, created_by)
           values ($1, $2, $3, 'GASOLINA', $4, current_date, $5)`,
          [s.a, s.boxA, movementId, amount, s.adminA],
        );

      expect((await insert(income, 5000))?.code, "apunta a un ingreso").toBe(CHECK_VIOLATION);
      expect((await insert(spend, 999))?.code, "otro importe").toBe(CHECK_VIOLATION);
      expect(await insert(spend, 1000)).toBeNull();
    });
  });

  it("quien registra un movimiento pertenece al mismo negocio", async () => {
    await withRollback(pool, async (client) => {
      const s = await seed(client);
      const error = await attempt(
        client,
        `insert into public.cash_movements (business_id, cashbox_id, type, direction, amount, created_by)
         values ($1, $2, 'INGRESO_CAPITAL', 'ENTRADA', 100, $3)`,
        [s.a, s.boxA, s.adminB],
      );
      expect(error?.code).toBe(FOREIGN_KEY_VIOLATION);
    });
  });

  it("reversar un ingreso ya gastado se rechaza por saldo negativo", async () => {
    await withRollback(pool, async (client) => {
      const s = await seed(client);
      const income = await movement(client, s, {
        type: "INGRESO_CAPITAL",
        direction: "ENTRADA",
        amount: 1000,
      });
      await movement(client, s, { type: "GASTO_CAJA_MAYOR", direction: "SALIDA", amount: 600 });
      await client.query("set constraints cash_movements_balance_not_negative immediate");

      const error = await tryMovement(client, s, {
        type: "REVERSO",
        direction: "SALIDA",
        amount: 1000,
        reason: "Error",
        reverses: income,
      });
      expect(error?.constraint).toBe("cashbox_balance_not_negative");
    });
  });

  it("el resultado de una clave de idempotencia se fija una sola vez", async () => {
    await withRollback(pool, async (client) => {
      const s = await seed(client);
      await client.query(
        "insert into public.idempotency_keys (business_id, command, key, payload_hash) values ($1, 'x', gen_random_uuid(), 'h')",
        [s.a],
      );
      expect(
        await attempt(client, "update public.idempotency_keys set result = '{\"n\":1}'"),
      ).toBeNull();
      expect(
        (await attempt(client, "update public.idempotency_keys set result = '{\"n\":2}'"))?.code,
      ).toBe(RESTRICT_VIOLATION);
    });
  });
});

describe("concurrencia del saldo", () => {
  it("dos salidas simultáneas que juntas superan el saldo: una confirma y la otra se rechaza", async () => {
    const setup = await pool.connect();
    let s!: Seed;
    try {
      await setup.query("begin");
      s = await seed(setup);
      await movement(setup, s, { type: "INGRESO_CAPITAL", direction: "ENTRADA", amount: 1000 });
      await setup.query("commit");
    } finally {
      setup.release();
    }

    const spend = async (): Promise<boolean> => {
      const client = await pool.connect();
      try {
        await client.query("begin");
        await movement(client, s, { type: "GASTO_CAJA_MAYOR", direction: "SALIDA", amount: 600 });
        await sleep(300); // las dos transacciones tienen su salida insertada antes de confirmar
        await client.query("commit");
        return true;
      } catch {
        await client.query("rollback");
        return false;
      } finally {
        client.release();
      }
    };

    try {
      const outcomes = await Promise.all([spend(), spend()]);
      expect(outcomes.filter(Boolean)).toHaveLength(1);
      const { rows } = await pool.query<{ balance: string }>(
        "select sum(case direction when 'ENTRADA' then amount else -amount end) as balance from public.cash_movements where cashbox_id = $1",
        [s.boxA],
      );
      expect(rows[0]!.balance).toBe("400");
    } finally {
      await cleanup(s);
    }
  });
});

describe("RLS del libro", () => {
  async function seedWithData(client: pg.PoolClient) {
    const s = await seed(client);
    await movement(client, s, { type: "SALDO_APERTURA", direction: "ENTRADA" });
    await movement(client, s, {
      type: "SALDO_APERTURA",
      direction: "ENTRADA",
      business: s.b,
      box: s.boxB,
    });
    // Un gasto de A para comprobar también la lectura de expenses.
    await movement(client, s, { type: "INGRESO_CAPITAL", direction: "ENTRADA", amount: 5000 });
    const spend = await movement(client, s, {
      type: "GASTO_CAJA_MAYOR",
      direction: "SALIDA",
      amount: 1000,
    });
    await client.query(
      `insert into public.expenses (business_id, cashbox_id, movement_id, category, amount, spent_on, created_by)
       values ($1, $2, $3, 'GASOLINA', 1000, current_date, $4)`,
      [s.a, s.boxA, spend, s.adminA],
    );
    return s;
  }

  const count = async (client: pg.PoolClient, table: string) =>
    (await client.query<{ n: string }>(`select count(*) as n from public.${table}`)).rows[0]!.n;

  it("el admin de A ve solo su caja y sus movimientos", async () => {
    await withRollback(pool, async (client) => {
      const s = await seedWithData(client);
      await asApiUser(client, { sub: s.adminA, app_role: "ADMIN_NEGOCIO", business_id: s.a });

      expect(await count(client, "main_cashboxes")).toBe("1");
      expect(await count(client, "cash_movements")).toBe("3");
      expect(await count(client, "expenses")).toBe("1");
    });
  });

  it("el Super Admin activo sigue leyendo identidad (negocios, usuarios, suscripciones) con las políticas reescritas", async () => {
    await withRollback(pool, async (client) => {
      const s = await seedWithData(client);
      const superAdmin = await createProfile(client, {
        role: "SUPER_ADMIN",
        businessId: null,
        username: "root.admin",
      });
      await asApiUser(client, { sub: superAdmin, app_role: "SUPER_ADMIN", business_id: null });
      // La base local puede tener otros negocios: se comprueba que ve al menos los dos sembrados.
      expect(Number(await count(client, "businesses"))).toBeGreaterThanOrEqual(2);
      expect(Number(await count(client, "profiles"))).toBeGreaterThanOrEqual(3);
      expect(Number(await count(client, "subscriptions"))).toBeGreaterThanOrEqual(2);
    });
  });

  it("cobrador y Super Admin no leen el libro; nadie escribe por la API de datos", async () => {
    await withRollback(pool, async (client) => {
      const s = await seedWithData(client);
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

      await asApiUser(client, { sub: collector, app_role: "COBRADOR", business_id: s.a });
      for (const table of ["cash_movements", "main_cashboxes", "expenses"]) {
        expect(await count(client, table), table).toBe("0");
      }
      await resetApiUser(client);
      await asApiUser(client, { sub: superAdmin, app_role: "SUPER_ADMIN", business_id: null });
      for (const table of ["cash_movements", "main_cashboxes", "expenses"]) {
        expect(await count(client, table), table).toBe("0");
      }
      await resetApiUser(client);

      await asApiUser(client, { sub: s.adminA, app_role: "ADMIN_NEGOCIO", business_id: s.a });
      for (const statement of [
        `insert into public.cash_movements (business_id, cashbox_id, type, direction, amount, created_by)
         values ('${s.a}', '${s.boxA}', 'INGRESO_CAPITAL', 'ENTRADA', 1, '${s.adminA}')`,
        "update public.cash_movements set amount = 1",
        "delete from public.cash_movements",
        "insert into public.idempotency_keys (business_id, command, key, payload_hash) values (gen_random_uuid(), 'x', gen_random_uuid(), 'h')",
        "select * from public.idempotency_keys",
      ]) {
        expect((await attempt(client, statement))?.code, statement).toBe("42501");
      }
    });
  });

  it("con la contraseña temporal pendiente, bloqueado o con el negocio suspendido no lee nada (JWT vigente)", async () => {
    await withRollback(pool, async (client) => {
      const s = await seedWithData(client);
      const read = async () => {
        await asApiUser(client, { sub: s.adminA, app_role: "ADMIN_NEGOCIO", business_id: s.a });
        const result = [
          await count(client, "cash_movements"),
          await count(client, "businesses"),
          await count(client, "subscriptions"),
        ];
        await resetApiUser(client);
        return result;
      };

      expect(await read()).toEqual(["3", "1", "1"]);

      await client.query(
        "update public.profiles set status = 'PENDIENTE_CAMBIO_CONTRASENA' where id = $1",
        [s.adminA],
      );
      expect(await read()).toEqual(["0", "0", "0"]);

      await client.query("update public.profiles set status = 'BLOQUEADO' where id = $1", [
        s.adminA,
      ]);
      expect(await read()).toEqual(["0", "0", "0"]);

      await client.query("update public.profiles set status = 'ACTIVO' where id = $1", [s.adminA]);
      await client.query(
        "update public.businesses set access_status = 'SUSPENDIDO' where id = $1",
        [s.a],
      );
      await client.query(
        "update public.subscriptions set status = 'SUSPENDIDA' where business_id = $1",
        [s.a],
      );
      expect(await read()).toEqual(["0", "0", "0"]);
    });
  });
});
