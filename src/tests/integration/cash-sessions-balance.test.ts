import { afterAll, describe, expect, it } from "vitest";
import { registerCapitalIncome, reverseMovement } from "@/modules/cash/commands";
import { getCashSummary } from "@/modules/cash/queries";
import { loadSessionContext } from "@/modules/identity/session";
import { AppError } from "@/shared/errors/app-error";
import type { IdempotencyKey } from "@/shared/ids/idempotency-key";
import { TestFixtures, createAdminClient } from "./helpers/auth";
import { createTestPool } from "./helpers/db";

// F5-T4: el saldo y el historial de la Caja Mayor de la aplicación no incluyen los movimientos de las
// cajas menores (los de una jornada), aunque vivan en el mismo libro.

const pool = createTestPool();
const fixtures = new TestFixtures(pool, createAdminClient());

afterAll(async () => {
  await fixtures.purge();
  await pool.end();
});

describe("Caja Mayor frente a las jornadas", () => {
  it("el saldo y el historial ignoran la Caja Menor y no se reversa un cobro de jornada desde la Mayor", async () => {
    const businessId = await fixtures.business("Mayor y menor");
    const adminAccount = await fixtures.account({ role: "ADMIN_NEGOCIO", businessId });
    const collectorAccount = await fixtures.account({ role: "COBRADOR", businessId });
    const admin = await loadSessionContext(adminAccount.userId, pool);
    await registerCapitalIncome({ db: pool }, admin, {
      idempotencyKey: crypto.randomUUID() as IdempotencyKey,
      amount: 1000,
    });

    const collector = (
      await pool.query<{ id: string }>(
        "insert into public.collectors (business_id, user_id, name, created_by) values ($1, $2, 'C', $3) returning id",
        [businessId, collectorAccount.userId, adminAccount.userId],
      )
    ).rows[0]!.id;
    const session = (
      await pool.query<{ id: string }>(
        "insert into public.cash_sessions (business_id, collector_id, business_date) values ($1, $2, current_date) returning id",
        [businessId, collector],
      )
    ).rows[0]!.id;
    const box = (
      await pool.query<{ id: string }>(
        "select id from public.main_cashboxes where business_id = $1",
        [businessId],
      )
    ).rows[0]!.id;
    // Fondo de 200 (un movimiento en cada caja) y un gasto de 30 en la jornada.
    const client = await pool.connect();
    let expenseMovement = "";
    try {
      await client.query("begin");
      await client.query(
        `insert into public.cash_movements (business_id, cashbox_id, type, direction, amount, reference_type, reference_id, created_by)
         values ($1, $2, 'FONDO_OPERATIVO', 'SALIDA', 200, 'session', $3, $4)`,
        [businessId, box, session, adminAccount.userId],
      );
      await client.query(
        `insert into public.cash_movements (business_id, cashbox_id, session_id, type, direction, amount, reference_type, reference_id, created_by)
         values ($1, $2, $3, 'FONDO_OPERATIVO', 'ENTRADA', 200, 'session', $3, $4)`,
        [businessId, box, session, adminAccount.userId],
      );
      expenseMovement = (
        await client.query<{ id: string }>(
          `insert into public.cash_movements (business_id, cashbox_id, session_id, type, direction, amount, created_by)
           values ($1, $2, $3, 'GASTO_COBRADOR', 'SALIDA', 30, $4) returning id`,
          [businessId, box, session, collectorAccount.userId],
        )
      ).rows[0]!.id;
      await client.query("commit");
    } finally {
      client.release();
    }

    const summary = await getCashSummary(pool, admin);
    expect(summary.balance).toBe(800);
    expect(summary.movements.map((m) => m.type).sort()).toEqual([
      "FONDO_OPERATIVO",
      "INGRESO_CAPITAL",
    ]);

    const error = await reverseMovement({ db: pool }, admin, {
      idempotencyKey: crypto.randomUUID() as IdempotencyKey,
      movementId: expenseMovement,
      reason: "x",
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("MOVEMENT_NOT_FOUND");
  });
});
