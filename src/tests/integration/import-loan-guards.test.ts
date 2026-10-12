import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { loadSessionContext, type SessionContext } from "@/modules/identity/session";
import { createClient } from "@/modules/portfolio/clients";
import { importLoan, previewImportedLoan } from "@/modules/portfolio/imports";
import { getLoanDetail } from "@/modules/portfolio/loan-queries";
import { isoDate } from "@/shared/dates/dates";
import { AppError } from "@/shared/errors/app-error";
import type { IdempotencyKey } from "@/shared/ids/idempotency-key";
import { TestFixtures, createAdminClient } from "./helpers/auth";
import { createTestPool } from "./helpers/db";

// Bordes de la importación (F3-T6): fechas en la zona del negocio, repartos no exactos, datos
// opcionales y rechazos que no dejan rastro.

const pool = createTestPool();
const fixtures = new TestFixtures(pool, createAdminClient());
const deps = { db: pool };

afterAll(async () => {
  await fixtures.purge();
  await pool.end();
});

const key = () => randomUUID() as IdempotencyKey;
const now = () => new Date("2026-10-13T17:00:00Z"); // 13/10/2026 12:00 en Bogotá
// 14/10 03:00 UTC = 13/10 22:00 en Bogotá: en UTC ya es el 14, para el negocio todavía es el 13.
const lateNight = () => new Date("2026-10-14T03:00:00Z");

async function setup() {
  const businessId = await fixtures.business("Importación bordes");
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

const rows = async (table: string, businessId: string) =>
  Number(
    (
      await pool.query<{ n: string }>(
        `select count(*) as n from public.${table} where business_id = $1`,
        [businessId],
      )
    ).rows[0]!.n,
  );

describe("fechas", () => {
  it("la fecha original puede ser hoy, y «hoy» es el día del negocio y no el de UTC", async () => {
    const { admin, clientId } = await setup();

    // El 13/10 22:00 en Bogotá (14/10 en UTC): original = 13/10 es hoy → válida; 14/10 sería futura.
    expect(
      (
        await previewImportedLoan(
          deps,
          admin,
          terms(clientId, {
            originalDate: isoDate("2026-10-13"),
            nextDueOn: isoDate("2026-10-13"),
          }),
          lateNight,
        )
      ).plan.installments[0]!.dueOn,
    ).toBe("2026-10-13");
    expect(
      await failureOf(
        previewImportedLoan(
          deps,
          admin,
          terms(clientId, { originalDate: isoDate("2026-10-14") }),
          lateNight,
        ),
      ),
    ).toMatchObject({ code: "IMPORT_DATE_IN_FUTURE" });
  });

  it("la próxima fecha de cobro puede ser igual a la original, pero no anterior", async () => {
    const { admin, clientId } = await setup();
    const same = terms(clientId, {
      originalDate: isoDate("2026-09-01"),
      nextDueOn: isoDate("2026-09-01"),
    });

    expect((await previewImportedLoan(deps, admin, same, now)).plan.installments[0]!.dueOn).toBe(
      "2026-09-01",
    );
    expect(
      await failureOf(
        previewImportedLoan(deps, admin, { ...same, nextDueOn: isoDate("2026-08-31") }, now),
      ),
    ).toMatchObject({ code: "NEXT_DUE_BEFORE_ORIGINAL" });
  });
});

describe("repartos y datos opcionales", () => {
  it("un saldo que no se divide exacto deja el resto en la última cuota y la suma coincide", async () => {
    const { admin, clientId } = await setup();

    const outcome = await importLoan(
      deps,
      admin,
      {
        ...terms(clientId, { pendingBalance: 1_000_000, installmentCount: 3 }),
        idempotencyKey: key(),
      },
      now,
    );

    const detail = await getLoanDetail(pool, admin, outcome.result.loanId, now());
    expect(detail!.installments.map((i) => i.amount)).toEqual([333_333, 333_333, 333_334]);
    expect(detail!.pendingBalance).toBe(1_000_000);
  });

  it("sin «ya pagado» se guarda nulo, y un saldo igual al total es válido", async () => {
    const { businessId, admin, clientId } = await setup();

    const outcome = await importLoan(
      deps,
      admin,
      {
        ...terms(clientId, { historicalPaid: undefined, pendingBalance: 1_200_000 }),
        idempotencyKey: key(),
      },
      now,
    );

    const loan = await pool.query<{ historical_paid_amount: string | null }>(
      "select historical_paid_amount::text from public.loans where id = $1",
      [outcome.result.loanId],
    );
    expect(loan.rows[0]).toEqual({ historical_paid_amount: null });
    const event = await pool.query<{ summary: { historicalPaid: number | null } }>(
      "select summary from public.audit_events where business_id = $1 and action = 'PrestamoCreado'",
      [businessId],
    );
    expect(event.rows[0]!.summary.historicalPaid).toBeNull();
    expect(
      (await getLoanDetail(pool, admin, outcome.result.loanId, now()))!.historicalPaid,
    ).toBeNull();
  });

  it("«ya pagado» en cero se guarda como cero, no como nulo", async () => {
    const { admin, clientId } = await setup();
    const outcome = await importLoan(
      deps,
      admin,
      { ...terms(clientId, { historicalPaid: 0 }), idempotencyKey: key() },
      now,
    );
    expect((await getLoanDetail(pool, admin, outcome.result.loanId, now()))!.historicalPaid).toBe(
      0,
    );
  });
});

describe("rechazos sin rastro y autorización", () => {
  it("más cuotas que pesos de saldo se rechaza sin crear nada ni consumir el número", async () => {
    const { businessId, admin, clientId } = await setup();

    expect(
      await failureOf(
        importLoan(
          deps,
          admin,
          { ...terms(clientId, { pendingBalance: 5, installmentCount: 7 }), idempotencyKey: key() },
          now,
        ),
      ),
    ).toMatchObject({ code: "INSTALLMENTS_EXCEED_TOTAL" });

    for (const table of [
      "contracts",
      "loans",
      "installments",
      "cash_movements",
      "expenses",
      "idempotency_keys",
    ]) {
      expect(await rows(table, businessId), table).toBe(0);
    }
    const ok = await importLoan(deps, admin, { ...terms(clientId), idempotencyKey: key() }, now);
    expect(ok.result.contractNumber).toBe("CT-000001");
  });

  it("el mismo envío con otro contenido es un 409 y no crea contratos extra", async () => {
    const { businessId, admin, clientId } = await setup();
    const idempotencyKey = key();
    await importLoan(deps, admin, { ...terms(clientId), idempotencyKey }, now);

    await failureOf(
      importLoan(deps, admin, { ...terms(clientId, { installmentCount: 6 }), idempotencyKey }, now),
    );

    expect(await rows("contracts", businessId)).toBe(1);
  });

  it("un cobrador no puede ni calcular la vista previa: 403 con evento RECHAZADO", async () => {
    const { businessId, clientId } = await setup();
    const collector = await loadSessionContext(
      (await fixtures.account({ role: "COBRADOR", businessId })).userId,
      pool,
    );

    expect(
      await failureOf(previewImportedLoan(deps, collector, terms(clientId), now)),
    ).toMatchObject({
      code: "FORBIDDEN",
    });
    const rejected = await pool.query(
      "select 1 from public.audit_events where business_id = $1 and action = 'VistaPreviaImportacion' and result = 'RECHAZADO'",
      [businessId],
    );
    expect(rejected.rowCount).toBe(1);
  });
});
