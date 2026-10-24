import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { loadSessionContext, type SessionContext } from "@/modules/identity/session";
import { createClient } from "@/modules/portfolio/clients";
import { importLoan } from "@/modules/portfolio/imports";
import { getLoanDetail } from "@/modules/portfolio/loan-queries";
import { isoDate } from "@/shared/dates/dates";
import { AppError } from "@/shared/errors/app-error";
import type { IdempotencyKey } from "@/shared/ids/idempotency-key";
import { TestFixtures, createAdminClient } from "./helpers/auth";
import { createTestPool } from "./helpers/db";

// Decisiones del 2026-10-24 sobre la importación (02 §6.1): montos por cuota escritos por el Admin,
// descuadre histórico con confirmación y observación auditadas, y una importación que no bloquea la
// Caja Mayor porque no la toca.

const pool = createTestPool();
const fixtures = new TestFixtures(pool, createAdminClient());
const deps = { db: pool };

afterAll(async () => {
  await fixtures.purge();
  await pool.end();
});

const key = () => randomUUID() as IdempotencyKey;
const now = () => new Date("2026-10-13T17:00:00Z"); // 13/10/2026 12:00 en Bogotá

async function setup() {
  const businessId = await fixtures.business("Importación montos");
  const account = await fixtures.account({ role: "ADMIN_NEGOCIO", businessId });
  const admin: SessionContext = await loadSessionContext(account.userId, pool);
  const client = await createClient(deps, admin, {
    name: "Ana",
    identification: randomUUID().slice(0, 8),
  });
  return { businessId, admin, clientId: client.id };
}

// 1.200.000 total − 500.000 pagado − 700.000 pendiente = 0: por defecto los datos cuadran.
const terms = (clientId: string, overrides: Record<string, unknown> = {}) => ({
  clientId,
  originalDate: isoDate("2026-08-01"),
  principal: 1_000_000,
  interestBps: 2000,
  frequency: "SEMANAL" as const,
  historicalPaid: 500_000,
  pendingBalance: 700_000,
  installmentCount: 3,
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

/** Nada de lo que crea una importación, ni la reserva de la clave, ni dinero alguno. */
async function expectNothingCreated(businessId: string) {
  for (const table of ["contracts", "loans", "installments", "idempotency_keys"]) {
    expect(await rows(table, businessId), table).toBe(0);
  }
  await expectNoMoney(businessId);
}

/** Ni pagos ni movimientos de caja: la importación no crea hechos de dinero (02 §6.1). */
async function expectNoMoney(businessId: string) {
  for (const table of ["payments", "payment_applications", "cash_movements"]) {
    expect(await rows(table, businessId), table).toBe(0);
  }
}

async function auditOf(businessId: string, action: string) {
  const found = await pool.query<{ summary: Record<string, unknown> }>(
    "select summary from public.audit_events where business_id = $1 and action = $2",
    [businessId, action],
  );
  return found.rows.map((row) => row.summary);
}

describe("montos por cuota escritos por el Admin", () => {
  it("guarda los montos editados que suman el saldo, sin pagos ni movimientos, y audita que cambiaron", async () => {
    const { businessId, admin, clientId } = await setup();

    const outcome = await importLoan(
      deps,
      admin,
      {
        ...terms(clientId, { installmentAmounts: [100_000, 250_000, 350_000] }),
        idempotencyKey: key(),
      },
      now,
    );

    expect(outcome.result).toMatchObject({ scheduled: 700_000, installmentCount: 3 });
    const detail = await getLoanDetail(pool, admin, outcome.result.loanId, now());
    expect(
      detail!.installments.map(({ number, dueOn, amount }) => ({ number, dueOn, amount })),
    ).toEqual([
      { number: 1, dueOn: "2026-10-20", amount: 100_000 },
      { number: 2, dueOn: "2026-10-27", amount: 250_000 },
      { number: 3, dueOn: "2026-11-03", amount: 350_000 },
    ]);
    expect(detail!.pendingBalance).toBe(700_000);
    await expectNoMoney(businessId);
    expect(await auditOf(businessId, "CuotasGeneradas")).toEqual([
      expect.objectContaining({ count: 3, total: 700_000, customAmounts: true }),
    ]);
  });

  it("sin montos (o con el reparto propuesto) reparte en partes iguales y no lo marca como cambiado", async () => {
    const { businessId, admin, clientId } = await setup();

    await importLoan(deps, admin, { ...terms(clientId), idempotencyKey: key() }, now);
    const proposed = await importLoan(
      deps,
      admin,
      {
        ...terms(clientId, { installmentAmounts: [233_333, 233_333, 233_334] }),
        idempotencyKey: key(),
      },
      now,
    );

    expect(
      (await getLoanDetail(pool, admin, proposed.result.loanId, now()))!.installments.map(
        (i) => i.amount,
      ),
    ).toEqual([233_333, 233_333, 233_334]);
    expect((await auditOf(businessId, "CuotasGeneradas")).map((s) => s.customAmounts)).toEqual([
      false,
      false,
    ]);
  });

  it("una suma distinta del saldo, o una cantidad distinta de cuotas, se rechaza sin dejar nada", async () => {
    const { businessId, admin, clientId } = await setup();

    for (const [installmentAmounts, code] of [
      [[100_000, 250_000, 349_999], "INSTALLMENT_AMOUNTS_SUM_MISMATCH"],
      [[100_000, 250_000, 350_001], "INSTALLMENT_AMOUNTS_SUM_MISMATCH"],
      [[350_000, 350_000], "INSTALLMENT_AMOUNTS_COUNT_MISMATCH"],
    ] as const) {
      expect(
        await failureOf(
          importLoan(
            deps,
            admin,
            { ...terms(clientId, { installmentAmounts }), idempotencyKey: key() },
            now,
          ),
        ),
        installmentAmounts.join(","),
      ).toMatchObject({ code, status: 400 });
    }

    await expectNothingCreated(businessId);
    // El número de contrato tampoco se consumió.
    const ok = await importLoan(deps, admin, { ...terms(clientId), idempotencyKey: key() }, now);
    expect(ok.result.contractNumber).toBe("CT-000001");
  });
});

describe("descuadre histórico", () => {
  // 1.200.000 − 100.000 pagado − 700.000 pendiente = 400.000 que no cuadran.
  const unbalanced = (clientId: string, overrides: Record<string, unknown> = {}) =>
    terms(clientId, { historicalPaid: 100_000, ...overrides });

  it("sin confirmación explícita es un 409, y confirmado sin observación un 400, sin dejar nada", async () => {
    const { businessId, admin, clientId } = await setup();

    expect(
      await failureOf(
        importLoan(deps, admin, { ...unbalanced(clientId), idempotencyKey: key() }, now),
      ),
    ).toMatchObject({ code: "IMPORT_MISMATCH_UNCONFIRMED", status: 409 });
    expect(
      await failureOf(
        importLoan(
          deps,
          admin,
          {
            ...unbalanced(clientId, { confirmMismatch: false, mismatchNote: "Abonos" }),
            idempotencyKey: key(),
          },
          now,
        ),
      ),
    ).toMatchObject({ code: "IMPORT_MISMATCH_UNCONFIRMED", status: 409 });
    for (const mismatchNote of [undefined, "   "]) {
      expect(
        await failureOf(
          importLoan(
            deps,
            admin,
            {
              ...unbalanced(clientId, { confirmMismatch: true, mismatchNote }),
              idempotencyKey: key(),
            },
            now,
          ),
        ),
      ).toMatchObject({ code: "IMPORT_MISMATCH_NOTE_REQUIRED", status: 400 });
    }

    await expectNothingCreated(businessId);
  });

  it("con confirmación y observación importa el saldo escrito y audita la diferencia y la observación", async () => {
    const { businessId, admin, clientId } = await setup();

    const outcome = await importLoan(
      deps,
      admin,
      {
        ...unbalanced(clientId, {
          confirmMismatch: true,
          mismatchNote: "Hubo abonos de interés que no se anotaron",
        }),
        idempotencyKey: key(),
      },
      now,
    );

    expect(outcome.result).toMatchObject({ total: 1_200_000, scheduled: 700_000 });
    expect(await auditOf(businessId, "PrestamoCreado")).toEqual([
      expect.objectContaining({
        historicalPaid: 100_000,
        pendingBalance: 700_000,
        historicalDifference: 400_000,
        mismatchNote: "Hubo abonos de interés que no se anotaron",
      }),
    ]);
    await expectNoMoney(businessId);
  });

  it("si los datos cuadran o no hay «ya pagado», no exige confirmación y la auditoría no trae observación", async () => {
    const { businessId, admin, clientId } = await setup();

    await importLoan(deps, admin, { ...terms(clientId), idempotencyKey: key() }, now);
    await importLoan(
      deps,
      admin,
      { ...terms(clientId, { historicalPaid: undefined }), idempotencyKey: key() },
      now,
    );

    expect(
      (await auditOf(businessId, "PrestamoCreado")).map((s) => [
        s.historicalDifference,
        s.mismatchNote,
      ]),
    ).toEqual(
      expect.arrayContaining([
        [0, null],
        [null, null],
      ]),
    );
  });
});

describe("la importación no bloquea la Caja Mayor", () => {
  it("se completa mientras otra operación retiene la caja del negocio", async () => {
    const { businessId, admin, clientId } = await setup();
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

      // Con el bloqueo de caja, esto esperaría el tope (5 s) y respondería OPERATION_IN_PROGRESS.
      const outcome = await importLoan(
        deps,
        admin,
        { ...terms(clientId), idempotencyKey: key() },
        now,
      );
      expect(outcome.replayed).toBe(false);
    } finally {
      await holder.query("rollback");
      holder.release();
    }
    expect(await rows("loans", businessId)).toBe(1);
    await expectNoMoney(businessId);
  }, 15_000);

  it("sin el bloqueo, dos envíos simultáneos con la misma clave siguen importando una sola vez", async () => {
    const { businessId, admin, clientId } = await setup();
    const idempotencyKey = key();

    const outcomes = await Promise.all(
      [1, 2, 3].map(() => importLoan(deps, admin, { ...terms(clientId), idempotencyKey }, now)),
    );

    expect(outcomes.filter((outcome) => !outcome.replayed)).toHaveLength(1);
    expect(new Set(outcomes.map((outcome) => outcome.result.loanId)).size).toBe(1);
    expect(await rows("loans", businessId)).toBe(1);
    expect(await rows("contracts", businessId)).toBe(1);
  });
});
