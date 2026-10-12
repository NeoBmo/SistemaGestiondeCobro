import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { registerCapitalIncome, reverseMovement } from "@/modules/cash/commands";
import { getCashSummary } from "@/modules/cash/queries";
import { loadSessionContext, type SessionContext } from "@/modules/identity/session";
import { createClient } from "@/modules/portfolio/clients";
import { annulContract, confirmContract } from "@/modules/portfolio/contracts";
import { isoDate } from "@/shared/dates/dates";
import type { IdempotencyKey } from "@/shared/ids/idempotency-key";
import { TestFixtures, createAdminClient } from "./helpers/auth";
import { createTestPool } from "./helpers/db";

// Barreras de la anulación (F3-T5): préstamo sin desembolso (importado), contenido de la auditoría,
// motivo en el reverso y rechazo del reverso manual del desembolso.

const pool = createTestPool();
const fixtures = new TestFixtures(pool, createAdminClient());
const deps = { db: pool };

afterAll(async () => {
  await fixtures.purge();
  await pool.end();
});

const key = () => randomUUID() as IdempotencyKey;
const now = () => new Date("2026-10-13T17:00:00Z");

async function setup() {
  const businessId = await fixtures.business("Anulaciones barreras");
  const account = await fixtures.account({ role: "ADMIN_NEGOCIO", businessId });
  const admin: SessionContext = await loadSessionContext(account.userId, pool);
  const client = await createClient(deps, admin, {
    name: "Ana",
    identification: randomUUID().slice(0, 8),
  });
  await registerCapitalIncome(deps, admin, { idempotencyKey: key(), amount: 2_000_000 });
  return { businessId, admin, clientId: client.id };
}

describe("anulación: contenido y trazabilidad", () => {
  it("el reverso lleva el motivo y el número de contrato, y la auditoría explica cada paso", async () => {
    const { businessId, admin, clientId } = await setup();
    const confirmed = await confirmContract(
      deps,
      admin,
      {
        clientId,
        principal: 800_000,
        interestBps: 1000,
        frequency: "SEMANAL",
        installmentCount: 4,
        firstDueOn: isoDate("2026-10-20"),
        idempotencyKey: key(),
      },
      now,
    );

    const outcome = await annulContract(deps, admin, {
      idempotencyKey: key(),
      loanId: confirmed.result.loanId,
      reason: "Datos equivocados",
    });

    const reversal = await pool.query<{ reason: string; created_by: string }>(
      "select reason, created_by from public.cash_movements where id = $1",
      [outcome.result.reversalMovementId],
    );
    expect(reversal.rows[0]).toEqual({
      reason: "Anulación del contrato CT-000001: Datos equivocados",
      created_by: admin.userId,
    });

    const events = await pool.query<{
      action: string;
      entity_type: string;
      entity_id: string;
      summary: Record<string, unknown>;
    }>(
      `select action, entity_type, entity_id, summary from public.audit_events
        where business_id = $1 and action in ('ContratoAnulado','PrestamoAnulado','ReversoRegistrado')`,
      [businessId],
    );
    const byAction = Object.fromEntries(events.rows.map((e) => [e.action, e]));
    expect(byAction.ContratoAnulado).toMatchObject({
      entity_type: "contract",
      entity_id: confirmed.result.contractId,
      summary: { number: "CT-000001", reason: "Datos equivocados" },
    });
    expect(byAction.PrestamoAnulado).toMatchObject({
      entity_type: "loan",
      entity_id: confirmed.result.loanId,
      summary: {
        contractId: confirmed.result.contractId,
        reversalMovementId: outcome.result.reversalMovementId,
      },
    });
    expect(byAction.ReversoRegistrado).toMatchObject({
      entity_type: "cash_movement",
      entity_id: outcome.result.reversalMovementId,
      summary: {
        reversedMovementId: confirmed.result.movementId,
        reversedType: "DESEMBOLSO_PRESTAMO",
        amount: 800_000,
      },
    });
  });

  it("el desembolso no se puede reversar a mano desde la Caja Mayor, ni el reverso de la anulación", async () => {
    const { admin, clientId } = await setup();
    const confirmed = await confirmContract(
      deps,
      admin,
      {
        clientId,
        principal: 500_000,
        interestBps: 0,
        frequency: "DIARIA",
        installmentCount: 5,
        firstDueOn: isoDate("2026-10-14"),
        idempotencyKey: key(),
      },
      now,
    );

    await expect(
      reverseMovement(deps, admin, {
        idempotencyKey: key(),
        movementId: confirmed.result.movementId,
        reason: "A mano",
      }),
    ).rejects.toMatchObject({ code: "MOVEMENT_NOT_REVERSIBLE" });

    const annulled = await annulContract(deps, admin, {
      idempotencyKey: key(),
      loanId: confirmed.result.loanId,
      reason: "Error",
    });
    await expect(
      reverseMovement(deps, admin, {
        idempotencyKey: key(),
        movementId: annulled.result.reversalMovementId!,
        reason: "Deshacer",
      }),
    ).rejects.toMatchObject({ code: "MOVEMENT_NOT_REVERSIBLE" });
    expect((await getCashSummary(pool, admin)).balance).toBe(2_000_000);
  });
});

describe("anulación de un préstamo sin desembolso (p. ej. importado)", () => {
  it("anula contrato y préstamo sin tocar la Caja Mayor y devuelve el saldo actual", async () => {
    const { businessId, admin, clientId } = await setup();
    const client = await pool.connect();
    let loanId = "";
    try {
      await client.query("begin");
      const number = (
        await client.query<{ n: string }>("select private.next_contract_number($1) as n", [
          businessId,
        ])
      ).rows[0]!.n;
      const contractId = (
        await client.query<{ id: string }>(
          "insert into public.contracts (business_id, client_id, number, origin, created_by) values ($1, $2, $3, 'IMPORTADO', $4) returning id",
          [businessId, clientId, number, admin.userId],
        )
      ).rows[0]!.id;
      loanId = (
        await client.query<{ id: string }>(
          `insert into public.loans
             (business_id, contract_id, principal_amount, interest_bps, interest_amount, total_amount,
              scheduled_amount, disbursed_on, first_due_on, frequency, installment_count, created_by)
           values ($1, $2, 100, 0, 0, 100, 100, '2026-10-01', '2026-10-14', 'DIARIA', 1, $3) returning id`,
          [businessId, contractId, admin.userId],
        )
      ).rows[0]!.id;
      await client.query(
        "insert into public.installments (business_id, loan_id, number, due_on, amount) values ($1, $2, 1, '2026-10-14', 100)",
        [businessId, loanId],
      );
      await client.query("commit");
    } finally {
      client.release();
    }

    const outcome = await annulContract(deps, admin, {
      idempotencyKey: key(),
      loanId,
      reason: "Cartera mal cargada",
    });

    expect(outcome.result).toMatchObject({ reversalMovementId: null, balance: 2_000_000 });
    const reversos = await pool.query(
      "select 1 from public.cash_movements where business_id = $1 and type = 'REVERSO'",
      [businessId],
    );
    expect(reversos.rowCount).toBe(0);
    const state = await pool.query<{ contract: string; loan: string }>(
      `select k.status as contract, l.status as loan
         from public.loans l join public.contracts k on k.id = l.contract_id where l.id = $1`,
      [loanId],
    );
    expect(state.rows[0]).toEqual({ contract: "ANULADO", loan: "ANULADO" });
    const events = await pool.query<{ action: string }>(
      `select action from public.audit_events
        where business_id = $1 and action in ('ContratoAnulado','PrestamoAnulado','ReversoRegistrado')`,
      [businessId],
    );
    expect(events.rows.map((e) => e.action).sort()).toEqual(["ContratoAnulado", "PrestamoAnulado"]);
  });
});
