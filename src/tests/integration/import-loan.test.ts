import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { getCashSummary } from "@/modules/cash/queries";
import { loadSessionContext, type SessionContext } from "@/modules/identity/session";
import { createClient } from "@/modules/portfolio/clients";
import { annulContract } from "@/modules/portfolio/contracts";
import { importLoan, previewImportedLoan } from "@/modules/portfolio/imports";
import { getLoanDetail } from "@/modules/portfolio/loan-queries";
import { isoDate } from "@/shared/dates/dates";
import { AppError } from "@/shared/errors/app-error";
import type { IdempotencyKey } from "@/shared/ids/idempotency-key";
import { TestFixtures, createAdminClient } from "./helpers/auth";
import { createTestPool } from "./helpers/db";

// F3-T6 (02 §6.1, ADR 0007): la cartera importada no crea pagos, desembolsos ni movimientos de caja;
// guarda solo las cuotas que faltan y el histórico pagado como referencia.

const pool = createTestPool();
const fixtures = new TestFixtures(pool, createAdminClient());
const deps = { db: pool };

afterAll(async () => {
  await fixtures.purge();
  await pool.end();
});

const key = () => randomUUID() as IdempotencyKey;
const now = () => new Date("2026-10-13T17:00:00Z"); // hoy en Bogotá: 13/10/2026

async function setup() {
  const businessId = await fixtures.business("Importación");
  const account = await fixtures.account({ role: "ADMIN_NEGOCIO", businessId });
  const admin: SessionContext = await loadSessionContext(account.userId, pool);
  const client = await createClient(deps, admin, {
    name: "Ana",
    identification: randomUUID().slice(0, 8),
  });
  return { businessId, admin, clientId: client.id };
}

const terms = (clientId: string, overrides: Record<string, unknown> = {}) => ({
  clientId,
  originalDate: isoDate("2026-08-01"),
  principal: 1_000_000,
  interestBps: 2000,
  frequency: "SEMANAL" as const,
  historicalPaid: 500_000,
  pendingBalance: 700_000,
  installmentCount: 7,
  nextDueOn: isoDate("2026-10-20"),
  ...overrides,
});

async function failureOf(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("se esperaba un AppError");
}

const count = async (table: string, businessId: string, where = "true") =>
  Number(
    (
      await pool.query<{ n: string }>(
        `select count(*) as n from public.${table} where business_id = $1 and ${where}`,
        [businessId],
      )
    ).rows[0]!.n,
  );

describe("vista previa de la importación", () => {
  it("calcula las cuotas que faltan sobre el saldo pendiente y avisa de la mora anterior y de las diferencias", async () => {
    const { admin, clientId } = await setup();

    const preview = await previewImportedLoan(
      deps,
      admin,
      terms(clientId, { nextDueOn: isoDate("2026-10-06") }),
      now,
    );

    expect(preview.plan).toMatchObject({
      principal: 1_000_000,
      interest: 200_000,
      total: 1_200_000,
      scheduled: 700_000,
    });
    expect(preview.plan.installments).toHaveLength(7);
    expect(preview.plan.installments[0]).toEqual({
      number: 1,
      dueOn: "2026-10-06",
      amount: 100_000,
    });
    // La primera cuota (6/10) ya venció; la segunda (13/10) vence hoy y todavía no.
    expect(preview.overdueInstallments).toBe(1);
    // 1.200.000 total − 500.000 pagado − 700.000 pendiente = 0: los datos cuadran.
    expect(preview.difference).toBe(0);
    expect(
      (await previewImportedLoan(deps, admin, terms(clientId, { historicalPaid: 100_000 }), now))
        .difference,
    ).toBe(400_000);
    expect(
      (await previewImportedLoan(deps, admin, terms(clientId, { historicalPaid: undefined }), now))
        .difference,
    ).toBeNull();
  });

  it("rechaza fecha original futura, próxima fecha anterior a la original, cliente ajeno y saldo mayor al total", async () => {
    const mine = await setup();
    const other = await setup();

    expect(
      await failureOf(
        previewImportedLoan(
          deps,
          mine.admin,
          terms(mine.clientId, { originalDate: isoDate("2026-10-14") }),
          now,
        ),
      ),
    ).toMatchObject({ code: "IMPORT_DATE_IN_FUTURE" });
    expect(
      await failureOf(
        previewImportedLoan(
          deps,
          mine.admin,
          terms(mine.clientId, { nextDueOn: isoDate("2026-07-01") }),
          now,
        ),
      ),
    ).toMatchObject({ code: "NEXT_DUE_BEFORE_ORIGINAL" });
    expect(
      await failureOf(previewImportedLoan(deps, mine.admin, terms(other.clientId), now)),
    ).toMatchObject({ code: "CLIENT_NOT_FOUND", status: 404 });
    expect(
      await failureOf(
        previewImportedLoan(
          deps,
          mine.admin,
          terms(mine.clientId, { pendingBalance: 1_200_001 }),
          now,
        ),
      ),
    ).toMatchObject({ code: "PENDING_EXCEEDS_TOTAL" });
  });
});

describe("importar un préstamo", () => {
  it("crea contrato IMPORTADO, préstamo y las cuotas que faltan, sin tocar ninguna caja, y audita", async () => {
    const { businessId, admin, clientId } = await setup();

    const outcome = await importLoan(
      deps,
      admin,
      { ...terms(clientId, { comment: "Cartera del cuaderno" }), idempotencyKey: key() },
      now,
    );

    expect(outcome.replayed).toBe(false);
    expect(outcome.result).toMatchObject({
      contractNumber: "CT-000001",
      total: 1_200_000,
      scheduled: 700_000,
      installmentCount: 7,
    });

    // Ni pagos, ni desembolso, ni movimiento alguno en las cajas.
    expect(await count("cash_movements", businessId)).toBe(0);
    expect((await getCashSummary(pool, admin)).balance).toBe(0);

    const loan = await pool.query<{
      historical_paid_amount: string;
      disbursed_on: string;
      first_due_on: string;
      scheduled_amount: string;
      total_amount: string;
      origin: string;
    }>(
      `select l.historical_paid_amount::text, l.disbursed_on::text, l.first_due_on::text,
              l.scheduled_amount::text, l.total_amount::text, k.origin
         from public.loans l join public.contracts k on k.id = l.contract_id where l.id = $1`,
      [outcome.result.loanId],
    );
    expect(loan.rows[0]).toEqual({
      historical_paid_amount: "500000",
      disbursed_on: "2026-08-01",
      first_due_on: "2026-10-20",
      scheduled_amount: "700000",
      total_amount: "1200000",
      origin: "IMPORTADO",
    });

    const events = await pool.query<{ action: string; summary: Record<string, unknown> }>(
      "select action, summary from public.audit_events where business_id = $1 and action in ('ContratoCreado','ContratoConfirmado','PrestamoCreado','CuotasGeneradas','PrestamoDesembolsado')",
      [businessId],
    );
    expect(events.rows.map((e) => e.action).sort()).toEqual([
      "ContratoConfirmado",
      "ContratoCreado",
      "CuotasGeneradas",
      "PrestamoCreado",
    ]);
    const created = events.rows.find((e) => e.action === "PrestamoCreado")!;
    expect(created.summary).toMatchObject({
      origin: "IMPORTADO",
      originalDate: "2026-08-01",
      historicalPaid: 500_000,
      pendingBalance: 700_000,
    });

    const detail = await getLoanDetail(pool, admin, outcome.result.loanId, now());
    expect(detail).toMatchObject({
      origin: "IMPORTADO",
      pendingBalance: 700_000,
      overdueBalance: 0,
      nextDue: { number: 1, dueOn: "2026-10-20", amount: 100_000 },
    });
    expect(detail!.installments.reduce((sum, i) => sum + i.amount, 0)).toBe(700_000);
  });

  it("con fechas de vencimiento pasadas, las cuotas aparecen vencidas con sus días de mora", async () => {
    const { admin, clientId } = await setup();
    const outcome = await importLoan(
      deps,
      admin,
      { ...terms(clientId, { nextDueOn: isoDate("2026-10-06") }), idempotencyKey: key() },
      now,
    );

    const detail = await getLoanDetail(pool, admin, outcome.result.loanId, now());

    expect(detail!.installments[0]).toMatchObject({ number: 1, status: "VENCIDA", daysLate: 7 });
    expect(detail!.installments[1]).toMatchObject({ number: 2, status: "PENDIENTE", daysLate: 0 });
    expect(detail!.overdueBalance).toBe(100_000);
  });

  it("es idempotente y la misma clave con otro contenido es un 409", async () => {
    const { businessId, admin, clientId } = await setup();
    const idempotencyKey = key();
    const first = await importLoan(deps, admin, { ...terms(clientId), idempotencyKey }, now);

    const again = await importLoan(deps, admin, { ...terms(clientId), idempotencyKey }, now);
    expect(again).toEqual({ result: first.result, replayed: true });
    expect(
      await failureOf(
        importLoan(
          deps,
          admin,
          { ...terms(clientId, { pendingBalance: 600_000 }), idempotencyKey },
          now,
        ),
      ),
    ).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    expect(await count("loans", businessId)).toBe(1);
  });

  it("un cobrador no importa (403 con RECHAZADO) y un cliente de otro negocio es 404 sin dejar nada", async () => {
    const mine = await setup();
    const other = await setup();
    const collector = await loadSessionContext(
      (await fixtures.account({ role: "COBRADOR", businessId: mine.businessId })).userId,
      pool,
    );

    expect(
      await failureOf(
        importLoan(deps, collector, { ...terms(mine.clientId), idempotencyKey: key() }, now),
      ),
    ).toMatchObject({ code: "FORBIDDEN" });
    expect(
      await failureOf(
        importLoan(deps, mine.admin, { ...terms(other.clientId), idempotencyKey: key() }, now),
      ),
    ).toMatchObject({ code: "CLIENT_NOT_FOUND" });
    expect(await count("contracts", mine.businessId)).toBe(0);
    expect(
      await count(
        "audit_events",
        mine.businessId,
        "result = 'RECHAZADO' and action = 'ImportarPrestamo'",
      ),
    ).toBe(1);
  });

  it("un préstamo importado se puede anular: no hay desembolso que revertir y la caja no cambia", async () => {
    const { businessId, admin, clientId } = await setup();
    const outcome = await importLoan(
      deps,
      admin,
      { ...terms(clientId), idempotencyKey: key() },
      now,
    );

    const annulled = await annulContract(deps, admin, {
      idempotencyKey: key(),
      loanId: outcome.result.loanId,
      reason: "Cargado dos veces",
    });

    expect(annulled.result).toMatchObject({ reversalMovementId: null, balance: 0 });
    expect(await count("cash_movements", businessId)).toBe(0);
  });

  it("importar y luego crear contratos nuevos comparte la numeración del negocio", async () => {
    const { admin, clientId } = await setup();
    const a = await importLoan(deps, admin, { ...terms(clientId), idempotencyKey: key() }, now);
    const b = await importLoan(deps, admin, { ...terms(clientId), idempotencyKey: key() }, now);
    expect([a.result.contractNumber, b.result.contractNumber]).toEqual(["CT-000001", "CT-000002"]);
  });
});
