import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { loadSessionContext, type SessionContext } from "@/modules/identity/session";
import { getCashboxBalance } from "@/modules/cash/balance";
import { runCashCommand, type CashCommand } from "@/modules/cash/run-cash-command";
import { withTransaction } from "@/shared/database/with-transaction";
import { AppError } from "@/shared/errors/app-error";
import type { IdempotencyKey } from "@/shared/ids/idempotency-key";
import { TestFixtures, createAdminClient } from "./helpers/auth";
import { createTestPool } from "./helpers/db";

// 03-ARQUITECTURA §3 y ADR 0006: el ejecutor autoriza, serializa por caja, aplica la idempotencia,
// exige auditoría y lo deja todo o nada. Se prueba con un comando mínimo (un ingreso de capital).

const pool = createTestPool();
const fixtures = new TestFixtures(pool, createAdminClient());

afterAll(async () => {
  await fixtures.purge();
  await pool.end();
});

const key = () => randomUUID() as IdempotencyKey;

async function sessionOf(account: { userId: string }): Promise<SessionContext> {
  return loadSessionContext(account.userId, pool);
}

async function setup() {
  const businessId = await fixtures.business("Caja runner");
  const admin = await sessionOf(await fixtures.account({ role: "ADMIN_NEGOCIO", businessId }));
  return { businessId, admin };
}

type Counter = { executions: number };

/** Ingreso de capital con auditoría; cuenta cuántas veces se ejecutó realmente. */
function incomeCommand(
  actor: SessionContext,
  idempotencyKey: IdempotencyKey,
  amount: number,
  counter: Counter = { executions: 0 },
  overrides: Partial<CashCommand<{ movementId: string; amount: number }>> = {},
): CashCommand<{ movementId: string; amount: number }> {
  return {
    name: "TestIngresoCapital",
    actor,
    idempotencyKey,
    input: { amount },
    execute: async (tx, ctx) => {
      counter.executions += 1;
      const { rows } = await tx.query<{ id: string }>(
        `insert into public.cash_movements (business_id, cashbox_id, type, direction, amount, created_by)
         values ($1, $2, 'INGRESO_CAPITAL', 'ENTRADA', $3, $4) returning id`,
        [ctx.businessId, ctx.cashboxId, amount, ctx.actorId],
      );
      const movementId = rows[0]!.id;
      return {
        result: { movementId, amount },
        audit: [
          {
            action: "CapitalIngresado",
            entityType: "cash_movement",
            entityId: movementId,
            summary: { amount },
          },
        ],
      };
    },
    ...overrides,
  };
}

const balanceOf = (businessId: string) =>
  withTransaction(async (tx) => {
    const box = await tx.query<{ id: string }>(
      "select id from public.main_cashboxes where business_id = $1",
      [businessId],
    );
    return getCashboxBalance(tx, box.rows[0]!.id);
  }, pool);

const movementsOf = async (businessId: string) =>
  (
    await pool.query<{ n: string }>(
      "select count(*) as n from public.cash_movements where business_id = $1",
      [businessId],
    )
  ).rows[0]!.n;

const auditOf = async (businessId: string, action?: string) =>
  (
    await pool.query<{ action: string; result: string; actor_id: string }>(
      `select action, result, actor_id from public.audit_events
        where business_id = $1 and ($2::text is null or action = $2)`,
      [businessId, action ?? null],
    )
  ).rows;

async function failureOf(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("se esperaba un AppError");
}

describe("runCashCommand: camino feliz", () => {
  it("ejecuta, audita con actor y negocio de la sesión y guarda el resultado", async () => {
    const { businessId, admin } = await setup();
    const idempotencyKey = key();

    const outcome = await runCashCommand({ db: pool }, incomeCommand(admin, idempotencyKey, 5000));

    expect(outcome.replayed).toBe(false);
    expect(outcome.result.amount).toBe(5000);
    expect(await balanceOf(businessId)).toBe(5000);
    expect(await auditOf(businessId, "CapitalIngresado")).toEqual([
      { action: "CapitalIngresado", result: "OK", actor_id: admin.userId },
    ]);
    const stored = await pool.query<{ result: unknown }>(
      "select result from public.idempotency_keys where business_id = $1 and key = $2",
      [businessId, idempotencyKey],
    );
    expect(stored.rows[0]?.result).toEqual(outcome.result);
  });
});

describe("idempotencia", () => {
  it("el mismo comando con la misma clave devuelve el resultado guardado y no duplica el dinero", async () => {
    const { businessId, admin } = await setup();
    const idempotencyKey = key();
    const counter: Counter = { executions: 0 };

    const first = await runCashCommand(
      { db: pool },
      incomeCommand(admin, idempotencyKey, 700, counter),
    );
    const second = await runCashCommand(
      { db: pool },
      incomeCommand(admin, idempotencyKey, 700, counter),
    );

    expect(second).toEqual({ result: first.result, replayed: true });
    expect(counter.executions).toBe(1);
    expect(await balanceOf(businessId)).toBe(700);
    expect(await movementsOf(businessId)).toBe("1");
    expect(await auditOf(businessId, "CapitalIngresado")).toHaveLength(1);
  });

  it("la misma clave con otro contenido es un 409 y no cambia nada", async () => {
    const { businessId, admin } = await setup();
    const idempotencyKey = key();
    await runCashCommand({ db: pool }, incomeCommand(admin, idempotencyKey, 700));

    const error = await failureOf(
      runCashCommand({ db: pool }, incomeCommand(admin, idempotencyKey, 701)),
    );

    expect(error).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED", status: 409 });
    expect(await balanceOf(businessId)).toBe(700);
  });

  it("la clave es por comando y por negocio: otro comando o negocio con la misma clave ejecuta", async () => {
    const one = await setup();
    const two = await setup();
    const idempotencyKey = key();
    const counter: Counter = { executions: 0 };

    await runCashCommand({ db: pool }, incomeCommand(one.admin, idempotencyKey, 100, counter));
    await runCashCommand({ db: pool }, incomeCommand(two.admin, idempotencyKey, 100, counter));
    await runCashCommand(
      { db: pool },
      incomeCommand(one.admin, idempotencyKey, 100, counter, { name: "TestOtroComando" }),
    );

    expect(counter.executions).toBe(3);
    expect(await balanceOf(one.businessId)).toBe(200);
    expect(await balanceOf(two.businessId)).toBe(100);
  });

  it("envíos simultáneos con la misma clave ejecutan una sola vez y todos reciben el mismo resultado", async () => {
    const { businessId, admin } = await setup();
    const idempotencyKey = key();
    const counter: Counter = { executions: 0 };

    const outcomes = await Promise.all(
      Array.from({ length: 6 }, () =>
        runCashCommand({ db: pool }, incomeCommand(admin, idempotencyKey, 300, counter)),
      ),
    );

    expect(counter.executions).toBe(1);
    expect(outcomes.filter((o) => !o.replayed)).toHaveLength(1);
    expect(new Set(outcomes.map((o) => o.result.movementId)).size).toBe(1);
    expect(await balanceOf(businessId)).toBe(300);
  });
});

describe("todo o nada", () => {
  it("si el comando falla no queda dinero, auditoría ni reserva de la clave, y reintentar ejecuta", async () => {
    const { businessId, admin } = await setup();
    const idempotencyKey = key();
    let fail = true;

    const failing = incomeCommand(admin, idempotencyKey, 900, undefined, {
      execute: async (tx, ctx) => {
        await tx.query(
          `insert into public.cash_movements (business_id, cashbox_id, type, direction, amount, created_by)
           values ($1, $2, 'INGRESO_CAPITAL', 'ENTRADA', 900, $3)`,
          [ctx.businessId, ctx.cashboxId, ctx.actorId],
        );
        if (fail) throw new AppError("BOOM", "falla a mitad del comando", 500);
        return { result: { movementId: "x", amount: 900 }, audit: [] };
      },
    });
    await expect(runCashCommand({ db: pool }, failing)).rejects.toMatchObject({ code: "BOOM" });

    expect(await movementsOf(businessId)).toBe("0");
    expect(await auditOf(businessId, "CapitalIngresado")).toEqual([]);
    expect(
      (
        await pool.query("select 1 from public.idempotency_keys where business_id = $1", [
          businessId,
        ])
      ).rowCount,
    ).toBe(0);

    fail = false;
    const retry = await runCashCommand({ db: pool }, incomeCommand(admin, idempotencyKey, 900));
    expect(retry.replayed).toBe(false);
    expect(await balanceOf(businessId)).toBe(900);
  });

  it("un comando sin evento de auditoría se revierte por completo", async () => {
    const { businessId, admin } = await setup();
    const command = incomeCommand(admin, key(), 400, undefined, {
      execute: async (tx, ctx) => {
        await tx.query(
          `insert into public.cash_movements (business_id, cashbox_id, type, direction, amount, created_by)
           values ($1, $2, 'INGRESO_CAPITAL', 'ENTRADA', 400, $3)`,
          [ctx.businessId, ctx.cashboxId, ctx.actorId],
        );
        return { result: { movementId: "x", amount: 400 }, audit: [] };
      },
    });

    await expect(runCashCommand({ db: pool }, command)).rejects.toMatchObject({
      code: "AUDIT_REQUIRED",
    });
    expect(await movementsOf(businessId)).toBe("0");
  });

  it("si la base rechaza el saldo negativo al confirmar, no queda nada", async () => {
    const { businessId, admin } = await setup();
    const command = incomeCommand(admin, key(), 1, undefined, {
      execute: async (tx, ctx) => {
        await tx.query(
          `insert into public.cash_movements (business_id, cashbox_id, type, direction, amount, created_by)
           values ($1, $2, 'GASTO_CAJA_MAYOR', 'SALIDA', 50, $3)`,
          [ctx.businessId, ctx.cashboxId, ctx.actorId],
        );
        return {
          result: { movementId: "x", amount: 50 },
          audit: [{ action: "X", entityType: "cash_movement", entityId: randomUUID() }],
        };
      },
    });

    await expect(runCashCommand({ db: pool }, command)).rejects.toMatchObject({
      code: "INSUFFICIENT_FUNDS",
    });
    expect(await movementsOf(businessId)).toBe("0");
    expect(await auditOf(businessId, "X")).toEqual([]);
  });
});

describe("autorización", () => {
  it("solo el Admin del negocio: un cobrador recibe 403 y deja un evento RECHAZADO (uno por minuto)", async () => {
    const { businessId } = await setup();
    const collector = await sessionOf(await fixtures.account({ role: "COBRADOR", businessId }));
    const counter: Counter = { executions: 0 };

    for (let i = 0; i < 3; i += 1) {
      const error = await failureOf(
        runCashCommand({ db: pool }, incomeCommand(collector, key(), 100, counter)),
      );
      expect(error).toMatchObject({ code: "FORBIDDEN", status: 403 });
    }

    expect(counter.executions).toBe(0);
    expect(await movementsOf(businessId)).toBe("0");
    expect(await auditOf(businessId, "TestIngresoCapital")).toEqual([
      { action: "TestIngresoCapital", result: "RECHAZADO", actor_id: collector.userId },
    ]);
  });

  it("el Super Admin (sin negocio) recibe 403 sin evento y un admin con contraseña temporal pendiente, 403 de cambio de contraseña", async () => {
    const businessId = await fixtures.business("Caja pendiente");
    const superAdmin = await sessionOf(
      await fixtures.account({ role: "SUPER_ADMIN", businessId: null }),
    );
    const pending = await sessionOf(
      await fixtures.account({
        role: "ADMIN_NEGOCIO",
        businessId,
        status: "PENDIENTE_CAMBIO_CONTRASENA",
      }),
    );

    expect(
      await failureOf(runCashCommand({ db: pool }, incomeCommand(superAdmin, key(), 100))),
    ).toMatchObject({ code: "FORBIDDEN" });
    expect(
      await failureOf(runCashCommand({ db: pool }, incomeCommand(pending, key(), 100))),
    ).toMatchObject({ code: "PASSWORD_CHANGE_REQUIRED" });
    expect(await auditOf(businessId)).toEqual([]);
  });

  it("el negocio sale de la sesión: dos admins operan cada uno sobre su propia caja", async () => {
    const one = await setup();
    const two = await setup();

    await runCashCommand({ db: pool }, incomeCommand(one.admin, key(), 111));
    await runCashCommand({ db: pool }, incomeCommand(two.admin, key(), 222));

    expect(await balanceOf(one.businessId)).toBe(111);
    expect(await balanceOf(two.businessId)).toBe(222);
  });
});

describe("concurrencia", () => {
  it("comandos distintos del mismo negocio se serializan: todos se aplican sin perder ninguno", async () => {
    const { businessId, admin } = await setup();

    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        runCashCommand({ db: pool }, incomeCommand(admin, key(), 100 + i)),
      ),
    );

    expect(await movementsOf(businessId)).toBe("8");
    expect(await balanceOf(businessId)).toBe(
      Array.from({ length: 8 }, (_, i) => 100 + i).reduce((a, b) => a + b),
    );
  });

  it("si otra operación retiene la caja demasiado tiempo, responde 409 reintentable y no cambia nada", async () => {
    const { businessId, admin } = await setup();
    const box = await pool.query<{ id: string }>(
      "select id from public.main_cashboxes where business_id = $1",
      [businessId],
    );
    const holder = await pool.connect();
    try {
      await holder.query("begin");
      await holder.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `main-cashbox:${box.rows[0]!.id}`,
      ]);

      const error = await failureOf(runCashCommand({ db: pool }, incomeCommand(admin, key(), 100)));
      expect(error).toMatchObject({ code: "OPERATION_IN_PROGRESS", status: 409 });
    } finally {
      await holder.query("rollback");
      holder.release();
    }
    expect(await movementsOf(businessId)).toBe("0");
  }, 15_000);
});

/** Salida de Caja Mayor (gasto) sin más lógica: el saldo lo decide la base y se traduce a 409. */
function spendCommand(
  actor: SessionContext,
  idempotencyKey: IdempotencyKey,
  amount: number,
): CashCommand<{ movementId: string }> {
  return {
    name: "TestGasto",
    actor,
    idempotencyKey,
    input: { amount },
    execute: async (tx, ctx) => {
      const { rows } = await tx.query<{ id: string }>(
        `insert into public.cash_movements (business_id, cashbox_id, type, direction, amount, created_by)
         values ($1, $2, 'GASTO_CAJA_MAYOR', 'SALIDA', $3, $4) returning id`,
        [ctx.businessId, ctx.cashboxId, amount, ctx.actorId],
      );
      const movementId = rows[0]!.id;
      return {
        result: { movementId },
        audit: [{ action: "GastoRegistrado", entityType: "cash_movement", entityId: movementId }],
      };
    },
  };
}

describe("saldo, replays y resultado", () => {
  it("dos salidas simultáneas que juntas superan el saldo: una se aplica y la otra es un 409 entendible", async () => {
    const { businessId, admin } = await setup();
    await runCashCommand({ db: pool }, incomeCommand(admin, key(), 100));

    const outcomes = await Promise.allSettled([
      runCashCommand({ db: pool }, spendCommand(admin, key(), 80)),
      runCashCommand({ db: pool }, spendCommand(admin, key(), 80)),
    ]);

    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((o) => o.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "INSUFFICIENT_FUNDS", status: 409 });
    expect(await balanceOf(businessId)).toBe(20);
  });

  it("un saldo insuficiente no deja la clave reservada: corregido el saldo, el reintento se aplica", async () => {
    const { businessId, admin } = await setup();
    const idempotencyKey = key();

    await expect(
      runCashCommand({ db: pool }, spendCommand(admin, idempotencyKey, 50)),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS" });
    expect(await movementsOf(businessId)).toBe("0");

    await runCashCommand({ db: pool }, incomeCommand(admin, key(), 100));
    const retry = await runCashCommand({ db: pool }, spendCommand(admin, idempotencyKey, 50));
    expect(retry.replayed).toBe(false);
    expect(await balanceOf(businessId)).toBe(50);
  });

  it("un cobrador no puede obtener el resultado guardado de una clave del admin", async () => {
    const { businessId, admin } = await setup();
    const collector = await sessionOf(await fixtures.account({ role: "COBRADOR", businessId }));
    const idempotencyKey = key();
    await runCashCommand({ db: pool }, incomeCommand(admin, idempotencyKey, 100));

    const error = await failureOf(
      runCashCommand({ db: pool }, incomeCommand(collector, idempotencyKey, 100)),
    );

    expect(error).toMatchObject({ code: "FORBIDDEN" });
    expect(await balanceOf(businessId)).toBe(100);
  });

  it("el negocio es el de la sesión aunque la entrada traiga otro", async () => {
    const mine = await setup();
    const other = await setup();
    let seen = "";

    await runCashCommand(
      { db: pool },
      incomeCommand(mine.admin, key(), 10, undefined, {
        input: { amount: 10, businessId: other.businessId },
        execute: async (_tx, ctx) => {
          seen = ctx.businessId;
          return {
            result: { movementId: "x", amount: 10 },
            audit: [{ action: "X", entityType: "business", entityId: ctx.businessId }],
          };
        },
      }),
    );

    expect(seen).toBe(mine.businessId);
  });

  it("un comando sin resultado se revierte, y la primera respuesta es idéntica a un reenvío", async () => {
    const { businessId, admin } = await setup();
    const empty = incomeCommand(admin, key(), 10, undefined, {
      execute: async () => ({
        result: null as never,
        audit: [{ action: "X", entityType: "business", entityId: randomUUID() }],
      }),
    });
    await expect(runCashCommand({ db: pool }, empty)).rejects.toMatchObject({
      code: "COMMAND_RESULT_REQUIRED",
    });
    expect(await auditOf(businessId, "X")).toEqual([]);

    const idempotencyKey = key();
    const withUndefined = incomeCommand(admin, idempotencyKey, 10, undefined, {
      execute: async () => ({
        result: { a: 1, dropped: undefined } as never,
        audit: [{ action: "X", entityType: "business", entityId: randomUUID() }],
      }),
    });
    const first = await runCashCommand({ db: pool }, withUndefined);
    const second = await runCashCommand({ db: pool }, withUndefined);
    expect(first.result).toEqual({ a: 1 });
    expect(second.result).toEqual(first.result);
  });
});
