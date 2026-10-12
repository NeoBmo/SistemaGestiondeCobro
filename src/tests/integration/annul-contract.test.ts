import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { registerCapitalIncome } from "@/modules/cash/commands";
import { getCashSummary } from "@/modules/cash/queries";
import { loadSessionContext, type SessionContext } from "@/modules/identity/session";
import { createClient } from "@/modules/portfolio/clients";
import { annulContract, confirmContract } from "@/modules/portfolio/contracts";
import { getClientDetail } from "@/modules/portfolio/client-queries";
import { getLoanDetail } from "@/modules/portfolio/loan-queries";
import { isoDate } from "@/shared/dates/dates";
import { AppError } from "@/shared/errors/app-error";
import type { IdempotencyKey } from "@/shared/ids/idempotency-key";
import { TestFixtures, createAdminClient } from "./helpers/auth";
import { createTestPool } from "./helpers/db";

// F3-T5 (02 §2.2): anular un contrato exige motivo, anula contrato y préstamo juntos y revierte el
// desembolso con un REVERSO vinculado, todo en una transacción y de forma idempotente.

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
  const businessId = await fixtures.business("Anulaciones");
  const account = await fixtures.account({ role: "ADMIN_NEGOCIO", businessId });
  const admin: SessionContext = await loadSessionContext(account.userId, pool);
  const client = await createClient(deps, admin, {
    name: "Ana",
    identification: randomUUID().slice(0, 8),
  });
  await registerCapitalIncome(deps, admin, { idempotencyKey: key(), amount: 3_000_000 });
  const loan = await confirmContract(
    deps,
    admin,
    {
      clientId: client.id,
      principal: 1_000_000,
      interestBps: 2000,
      frequency: "DIARIA",
      installmentCount: 12,
      firstDueOn: isoDate("2026-10-14"),
      idempotencyKey: key(),
    },
    now,
  );
  return { businessId, admin, clientId: client.id, loan: loan.result };
}

async function failureOf(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("se esperaba un AppError");
}

describe("anular un contrato", () => {
  it("anula contrato y préstamo, revierte el desembolso y deja la auditoría", async () => {
    const { businessId, admin, clientId, loan } = await setup();
    expect((await getCashSummary(pool, admin)).balance).toBe(2_000_000);

    const outcome = await annulContract(deps, admin, {
      idempotencyKey: key(),
      loanId: loan.loanId,
      reason: "El cliente se arrepintió",
    });

    expect(outcome.replayed).toBe(false);
    expect(outcome.result).toMatchObject({
      contractNumber: "CT-000001",
      loanId: loan.loanId,
      balance: 3_000_000,
    });
    expect((await getCashSummary(pool, admin)).balance).toBe(3_000_000);

    // El desembolso original sigue en el historial y su reverso lo referencia.
    const movements = await pool.query<{
      id: string;
      type: string;
      direction: string;
      amount: string;
      reverses_movement_id: string | null;
    }>(
      `select id, type, direction, amount::text, reverses_movement_id from public.cash_movements
        where business_id = $1 and type in ('DESEMBOLSO_PRESTAMO','REVERSO')`,
      [businessId],
    );
    const disbursement = movements.rows.find((m) => m.type === "DESEMBOLSO_PRESTAMO")!;
    const reversal = movements.rows.find((m) => m.type === "REVERSO")!;
    expect(disbursement).toMatchObject({
      id: loan.movementId,
      direction: "SALIDA",
      amount: "1000000",
    });
    expect(reversal).toMatchObject({
      id: outcome.result.reversalMovementId,
      direction: "ENTRADA",
      amount: "1000000",
      reverses_movement_id: loan.movementId,
    });

    const state = await pool.query<{
      contract: string;
      loan: string;
      voided_by: string;
      reason: string;
    }>(
      `select k.status as contract, l.status as loan, k.voided_by, k.void_reason as reason
         from public.loans l join public.contracts k on k.id = l.contract_id where l.id = $1`,
      [loan.loanId],
    );
    expect(state.rows[0]).toEqual({
      contract: "ANULADO",
      loan: "ANULADO",
      voided_by: admin.userId,
      reason: "El cliente se arrepintió",
    });

    const events = await pool.query<{ action: string }>(
      `select action from public.audit_events
        where business_id = $1 and action in ('ContratoAnulado','PrestamoAnulado') order by action`,
      [businessId],
    );
    expect(events.rows.map((e) => e.action)).toEqual(["ContratoAnulado", "PrestamoAnulado"]);

    // La lectura refleja la anulación: sin saldo pendiente y sin préstamo activo para el cliente.
    const detail = await getLoanDetail(pool, admin, loan.loanId, now());
    expect(detail).toMatchObject({
      loanStatus: "ANULADO",
      pendingBalance: 0,
      voidReason: "El cliente se arrepintió",
    });
    expect(detail!.installments.every((i) => i.pendingAmount === 0)).toBe(true);
    const client = await getClientDetail(pool, admin, clientId);
    expect(client!.loans[0]).toMatchObject({ status: "ANULADO" });
  });

  it("es idempotente y un segundo intento con otra clave es un 409 que no devuelve el dinero dos veces", async () => {
    const { admin, loan } = await setup();
    const idempotencyKey = key();
    const input = { idempotencyKey, loanId: loan.loanId, reason: "Error" };

    const first = await annulContract(deps, admin, input);
    const again = await annulContract(deps, admin, input);
    expect(again).toEqual({ result: first.result, replayed: true });

    expect(
      await failureOf(annulContract(deps, admin, { ...input, idempotencyKey: key() })),
    ).toMatchObject({ code: "CONTRACT_ALREADY_VOIDED", status: 409 });
    expect(
      await failureOf(annulContract(deps, admin, { ...input, reason: "Otro motivo" })),
    ).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    expect((await getCashSummary(pool, admin)).balance).toBe(3_000_000);
  });

  it("dos anulaciones simultáneas: una se aplica y la otra es un 409", async () => {
    const { admin, loan } = await setup();

    const outcomes = await Promise.allSettled(
      [1, 2].map(() =>
        annulContract(deps, admin, { idempotencyKey: key(), loanId: loan.loanId, reason: "Error" }),
      ),
    );

    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((o) => o.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "CONTRACT_ALREADY_VOIDED" });
    expect((await getCashSummary(pool, admin)).balance).toBe(3_000_000);
  });

  it("un préstamo de otro negocio es «no encontrado»; un cobrador recibe 403 con evento RECHAZADO", async () => {
    const mine = await setup();
    const other = await setup();
    const collector = await loadSessionContext(
      (await fixtures.account({ role: "COBRADOR", businessId: mine.businessId })).userId,
      pool,
    );

    expect(
      await failureOf(
        annulContract(deps, mine.admin, {
          idempotencyKey: key(),
          loanId: other.loan.loanId,
          reason: "x",
        }),
      ),
    ).toMatchObject({ code: "LOAN_NOT_FOUND", status: 404 });
    expect(
      await failureOf(
        annulContract(deps, collector, {
          idempotencyKey: key(),
          loanId: mine.loan.loanId,
          reason: "x",
        }),
      ),
    ).toMatchObject({ code: "FORBIDDEN" });
    const rejected = await pool.query(
      "select 1 from public.audit_events where business_id = $1 and action = 'AnularContrato' and result = 'RECHAZADO'",
      [mine.businessId],
    );
    expect(rejected.rowCount).toBe(1);
    expect((await getCashSummary(pool, other.admin)).balance).toBe(2_000_000);
  });

  it("un préstamo se puede volver a crear con el dinero devuelto, y el siguiente contrato toma el número siguiente", async () => {
    const { admin, clientId, loan } = await setup();
    await annulContract(deps, admin, {
      idempotencyKey: key(),
      loanId: loan.loanId,
      reason: "Error",
    });

    const next = await confirmContract(
      deps,
      admin,
      {
        clientId,
        principal: 3_000_000,
        interestBps: 0,
        frequency: "MENSUAL",
        installmentCount: 3,
        firstDueOn: isoDate("2026-11-13"),
        idempotencyKey: key(),
      },
      now,
    );

    expect(next.result.contractNumber).toBe("CT-000002");
    expect(next.result.balance).toBe(0);
  });
});
