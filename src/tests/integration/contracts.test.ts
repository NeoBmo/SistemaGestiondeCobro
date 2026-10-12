import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { getCashboxBalance } from "@/modules/cash/balance";
import { registerCapitalIncome } from "@/modules/cash/commands";
import { loadSessionContext, type SessionContext } from "@/modules/identity/session";
import { createClient } from "@/modules/portfolio/clients";
import { confirmContract, previewLoan } from "@/modules/portfolio/contracts";
import { getLoanDetail } from "@/modules/portfolio/loan-queries";
import { withTransaction } from "@/shared/database/with-transaction";
import { isoDate } from "@/shared/dates/dates";
import { AppError } from "@/shared/errors/app-error";
import type { IdempotencyKey } from "@/shared/ids/idempotency-key";
import { TestFixtures, createAdminClient } from "./helpers/auth";
import { createTestPool } from "./helpers/db";

// F3-T4 (02 §2.2–2.4, ADR 0007): confirmar un contrato crea, en una transacción, el contrato con su
// número, el préstamo, las cuotas y el desembolso de Caja Mayor; es idempotente y no deja saldo negativo.

const pool = createTestPool();
const fixtures = new TestFixtures(pool, createAdminClient());
const deps = { db: pool };

afterAll(async () => {
  await fixtures.purge();
  await pool.end();
});

const key = () => randomUUID() as IdempotencyKey;
// 2026-10-13 12:00 en Bogotá (UTC-5): «hoy» del negocio es el 13 de octubre.
const now = () => new Date("2026-10-13T17:00:00Z");

type Setup = { businessId: string; admin: SessionContext; clientId: string };

async function setup(funds = 5_000_000): Promise<Setup> {
  const businessId = await fixtures.business("Contratos");
  const account = await fixtures.account({ role: "ADMIN_NEGOCIO", businessId });
  const admin = await loadSessionContext(account.userId, pool);
  const client = await createClient(deps, admin, {
    name: "Ana",
    identification: randomUUID().slice(0, 8),
  });
  if (funds > 0) await registerCapitalIncome(deps, admin, { idempotencyKey: key(), amount: funds });
  return { businessId, admin, clientId: client.id };
}

const terms = (clientId: string, overrides: Record<string, unknown> = {}) => ({
  clientId,
  principal: 1_000_000,
  interestBps: 2000,
  frequency: "DIARIA" as const,
  installmentCount: 12,
  firstDueOn: isoDate("2026-10-14"),
  ...overrides,
});

const balanceOf = (businessId: string) =>
  withTransaction(async (tx) => {
    const box = await tx.query<{ id: string }>(
      "select id from public.main_cashboxes where business_id = $1",
      [businessId],
    );
    return getCashboxBalance(tx, box.rows[0]!.id);
  }, pool);

const count = async (table: string, businessId: string) =>
  Number(
    (
      await pool.query<{ n: string }>(
        `select count(*) as n from public.${table} where business_id = $1`,
        [businessId],
      )
    ).rows[0]!.n,
  );

async function failureOf(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("se esperaba un AppError");
}

describe("vista previa", () => {
  it("calcula $1.000.000 al 20 % en 12 cuotas de $100.000 sin guardar nada", async () => {
    const { businessId, admin, clientId } = await setup();

    const preview = await previewLoan(deps, admin, terms(clientId), now);

    expect(preview.plan).toMatchObject({
      principal: 1_000_000,
      interest: 200_000,
      total: 1_200_000,
    });
    expect(preview.plan.installments).toHaveLength(12);
    expect(preview.plan.installments[0]).toEqual({
      number: 1,
      dueOn: "2026-10-14",
      amount: 100_000,
    });
    expect(preview.disbursedOn).toBe("2026-10-13");
    expect(preview.cashBalance).toBe(5_000_000);
    expect(preview.sufficientFunds).toBe(true);
    expect(await count("contracts", businessId)).toBe(0);
    expect(await count("loans", businessId)).toBe(0);
  });

  it("avisa cuando la caja no alcanza y rechaza una primera cuota anterior al desembolso", async () => {
    const { admin, clientId } = await setup(500_000);

    expect((await previewLoan(deps, admin, terms(clientId), now)).sufficientFunds).toBe(false);
    expect(
      await failureOf(
        previewLoan(deps, admin, terms(clientId, { firstDueOn: isoDate("2026-10-12") }), now),
      ),
    ).toMatchObject({ code: "FIRST_DUE_BEFORE_DISBURSEMENT" });
    expect(await failureOf(previewLoan(deps, admin, terms(randomUUID()), now))).toMatchObject({
      code: "CLIENT_NOT_FOUND",
    });
  });
});

describe("confirmar el contrato", () => {
  it("crea contrato, préstamo, cuotas y desembolso en una transacción y deja la auditoría", async () => {
    const { businessId, admin, clientId } = await setup();

    const outcome = await confirmContract(
      deps,
      admin,
      { ...terms(clientId, { comment: "Para el negocio" }), idempotencyKey: key() },
      now,
    );

    expect(outcome.replayed).toBe(false);
    expect(outcome.result).toMatchObject({
      contractNumber: "CT-000001",
      principal: 1_000_000,
      interest: 200_000,
      total: 1_200_000,
      installmentCount: 12,
      disbursedOn: "2026-10-13",
      balance: 4_000_000,
    });
    expect(await balanceOf(businessId)).toBe(4_000_000);

    const detail = await getLoanDetail(pool, admin, outcome.result.loanId, now());
    expect(detail).toMatchObject({
      contractNumber: "CT-000001",
      contractComment: "Para el negocio",
      loanStatus: "ACTIVO",
      origin: "NUEVO",
      client: { id: clientId },
      frequency: "DIARIA",
      firstDueOn: "2026-10-14",
      pendingBalance: 1_200_000,
      overdueBalance: 0,
      nextDue: { number: 1, dueOn: "2026-10-14", amount: 100_000 },
    });
    expect(detail!.installments).toHaveLength(12);
    expect(detail!.installments.reduce((sum, i) => sum + i.amount, 0)).toBe(1_200_000);

    const movement = await pool.query(
      "select type, direction, amount::text, reference_type, reference_id from public.cash_movements where id = $1",
      [outcome.result.movementId],
    );
    expect(movement.rows[0]).toEqual({
      type: "DESEMBOLSO_PRESTAMO",
      direction: "SALIDA",
      amount: "1000000",
      reference_type: "loan",
      reference_id: outcome.result.loanId,
    });

    const events = await pool.query<{ action: string }>(
      `select action from public.audit_events
        where business_id = $1 and action in ('ContratoCreado','ContratoConfirmado','PrestamoCreado','CuotasGeneradas','PrestamoDesembolsado')`,
      [businessId],
    );
    expect(events.rows.map((r) => r.action).sort()).toEqual([
      "ContratoConfirmado",
      "ContratoCreado",
      "CuotasGeneradas",
      "PrestamoCreado",
      "PrestamoDesembolsado",
    ]);
  });

  it("reenviar la misma clave no desembolsa dos veces; cada contrato nuevo toma el siguiente número", async () => {
    const { businessId, admin, clientId } = await setup();
    const idempotencyKey = key();

    const first = await confirmContract(deps, admin, { ...terms(clientId), idempotencyKey }, now);
    const again = await confirmContract(deps, admin, { ...terms(clientId), idempotencyKey }, now);
    const second = await confirmContract(
      deps,
      admin,
      { ...terms(clientId), idempotencyKey: key() },
      now,
    );

    expect(again).toEqual({ result: first.result, replayed: true });
    expect(second.result.contractNumber).toBe("CT-000002");
    expect(await count("contracts", businessId)).toBe(2);
    expect(await balanceOf(businessId)).toBe(3_000_000);
  });

  it("un cliente puede tener varios préstamos activos", async () => {
    const { admin, clientId } = await setup();
    await confirmContract(deps, admin, { ...terms(clientId), idempotencyKey: key() }, now);
    await confirmContract(
      deps,
      admin,
      {
        ...terms(clientId, { principal: 500_000, frequency: "SEMANAL", installmentCount: 6 }),
        idempotencyKey: key(),
      },
      now,
    );

    const { rows } = await pool.query<{ n: string }>(
      `select count(*) as n from public.loans l join public.contracts k on k.id = l.contract_id
        where k.client_id = $1 and l.status = 'ACTIVO'`,
      [clientId],
    );
    expect(rows[0]!.n).toBe("2");
  });

  it("si la caja no alcanza para el principal se rechaza (409) sin dejar nada ni consumir el número", async () => {
    const { businessId, admin, clientId } = await setup(900_000);

    const error = await failureOf(
      confirmContract(deps, admin, { ...terms(clientId), idempotencyKey: key() }, now),
    );

    expect(error).toMatchObject({ code: "INSUFFICIENT_FUNDS", status: 409 });
    for (const table of ["contracts", "loans", "installments"]) {
      expect(await count(table, businessId), table).toBe(0);
    }
    expect(await balanceOf(businessId)).toBe(900_000);
    // El número no se consumió: el primer contrato que sí se confirme es el CT-000001.
    await registerCapitalIncome(deps, admin, { idempotencyKey: key(), amount: 200_000 });
    const ok = await confirmContract(
      deps,
      admin,
      { ...terms(clientId), idempotencyKey: key() },
      now,
    );
    expect(ok.result.contractNumber).toBe("CT-000001");
  });

  it("gastar exactamente todo el saldo en el desembolso es válido", async () => {
    const { admin, clientId } = await setup(1_000_000);

    const outcome = await confirmContract(
      deps,
      admin,
      { ...terms(clientId), idempotencyKey: key() },
      now,
    );

    expect(outcome.result.balance).toBe(0);
  });

  it("dos confirmaciones simultáneas que juntas superan la caja: una se aplica y la otra es un 409", async () => {
    const { businessId, admin, clientId } = await setup(1_500_000);

    const outcomes = await Promise.allSettled(
      [1, 2].map(() =>
        confirmContract(deps, admin, { ...terms(clientId), idempotencyKey: key() }, now),
      ),
    );

    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((o) => o.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "INSUFFICIENT_FUNDS" });
    expect(await count("loans", businessId)).toBe(1);
    expect(await balanceOf(businessId)).toBe(500_000);
  });

  it("clientes y condiciones inválidos se rechazan sin dejar rastro", async () => {
    const mine = await setup();
    const other = await setup();

    expect(
      await failureOf(
        confirmContract(deps, mine.admin, { ...terms(other.clientId), idempotencyKey: key() }, now),
      ),
    ).toMatchObject({ code: "CLIENT_NOT_FOUND", status: 404 });
    expect(
      await failureOf(
        confirmContract(
          deps,
          mine.admin,
          { ...terms(mine.clientId, { installmentCount: 0 }), idempotencyKey: key() },
          now,
        ),
      ),
    ).toMatchObject({ code: "INVALID_INSTALLMENT_COUNT" });
    expect(
      await failureOf(
        confirmContract(
          deps,
          mine.admin,
          { ...terms(mine.clientId, { firstDueOn: isoDate("2026-10-01") }), idempotencyKey: key() },
          now,
        ),
      ),
    ).toMatchObject({ code: "FIRST_DUE_BEFORE_DISBURSEMENT" });
    expect(await count("contracts", mine.businessId)).toBe(0);
    expect(await count("contracts", other.businessId)).toBe(0);
  });

  it("un cobrador no confirma contratos: 403 y evento RECHAZADO", async () => {
    const { businessId, clientId } = await setup();
    const collector = await loadSessionContext(
      (await fixtures.account({ role: "COBRADOR", businessId })).userId,
      pool,
    );

    expect(
      await failureOf(
        confirmContract(deps, collector, { ...terms(clientId), idempotencyKey: key() }, now),
      ),
    ).toMatchObject({ code: "FORBIDDEN" });
    expect(await count("contracts", businessId)).toBe(0);
    const rejected = await pool.query(
      "select 1 from public.audit_events where business_id = $1 and action = 'ConfirmarContrato' and result = 'RECHAZADO'",
      [businessId],
    );
    expect(rejected.rowCount).toBe(1);
  });
});

describe("consulta del préstamo", () => {
  it("deriva el estado de las cuotas con la fecha del negocio y aísla por negocio", async () => {
    const mine = await setup();
    const other = await setup();
    const outcome = await confirmContract(
      deps,
      mine.admin,
      { ...terms(mine.clientId), idempotencyKey: key() },
      now,
    );

    // 3 días después del primer vencimiento: la cuota 1 venció hace 3 días, la 2 hace 2, la 3 hace 1 y la 4 vence hoy.
    const later = new Date("2026-10-17T17:00:00Z");
    const detail = await getLoanDetail(pool, mine.admin, outcome.result.loanId, later);

    expect(detail!.installments.slice(0, 5).map((i) => [i.number, i.status, i.daysLate])).toEqual([
      [1, "VENCIDA", 3],
      [2, "VENCIDA", 2],
      [3, "VENCIDA", 1],
      [4, "PENDIENTE", 0],
      [5, "PENDIENTE", 0],
    ]);
    expect(detail!.overdueBalance).toBe(300_000);
    expect(detail!.nextDue).toEqual({ number: 4, dueOn: "2026-10-17", amount: 100_000 });
    expect(await getLoanDetail(pool, other.admin, outcome.result.loanId)).toBeNull();
    expect(await getLoanDetail(pool, mine.admin, "no-es-uuid")).toBeNull();
  });
});
