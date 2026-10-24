import { afterAll, describe, expect, it } from "vitest";
import { recordRejectedAttempt } from "@/modules/audit/record-rejection";
import type { Tx } from "@/shared/database/with-transaction";
import { TestFixtures, createAdminClient } from "./helpers/auth";
import { createTestPool } from "./helpers/db";

// ADR 0005: un solo evento RECHAZADO por actor, acción y entidad por minuto, también bajo concurrencia
// (antes se leía y luego se insertaba sin bloqueo: dos rechazos simultáneos dejaban dos eventos).

const pool = createTestPool();
const fixtures = new TestFixtures(pool, createAdminClient());

afterAll(async () => {
  await fixtures.purge();
  await pool.end();
});

describe("recordRejectedAttempt", () => {
  it("rechazos simultáneos del mismo actor, acción y entidad dejan un único evento", async () => {
    const business = await fixtures.business();
    const intruder = await fixtures.account({ role: "SUPER_ADMIN", businessId: null });
    const attempt = {
      actor: { userId: intruder.userId, role: "COBRADOR" },
      businessId: business,
      action: "NegocioSuspendido",
      entityType: "business",
      entityId: business,
    };
    // `exists` lento: todas las transacciones llegan a la vez a la lectura de deduplicación.
    const slowExists = async (tx: Tx) => {
      await tx.query("select pg_sleep(0.2)");
      return true;
    };

    await Promise.all(
      Array.from({ length: 6 }, () => recordRejectedAttempt(pool, attempt, slowExists)),
    );

    const { rows } = await pool.query(
      `select result from public.audit_events
        where actor_id = $1 and entity_id = $2 and action = 'NegocioSuspendido'`,
      [intruder.userId, business],
    );
    expect(rows).toEqual([{ result: "RECHAZADO" }]);
  });

  it("otra acción u otra entidad del mismo actor sí deja su propio evento", async () => {
    const [a, b] = [await fixtures.business(), await fixtures.business()];
    const intruder = await fixtures.account({ role: "SUPER_ADMIN", businessId: null });
    const base = { actor: { userId: intruder.userId, role: "COBRADOR" }, entityType: "business" };
    const exists = async () => true;

    await Promise.all([
      recordRejectedAttempt(pool, { ...base, businessId: a, entityId: a, action: "X" }, exists),
      recordRejectedAttempt(pool, { ...base, businessId: a, entityId: a, action: "Y" }, exists),
      recordRejectedAttempt(pool, { ...base, businessId: b, entityId: b, action: "X" }, exists),
    ]);

    const { rowCount } = await pool.query(
      "select 1 from public.audit_events where actor_id = $1 and result = 'RECHAZADO'",
      [intruder.userId],
    );
    expect(rowCount).toBe(3);
  });
});
