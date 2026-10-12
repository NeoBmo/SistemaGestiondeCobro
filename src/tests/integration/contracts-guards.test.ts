import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { registerCapitalIncome } from "@/modules/cash/commands";
import { loadSessionContext, type SessionContext } from "@/modules/identity/session";
import { createClient } from "@/modules/portfolio/clients";
import { confirmContract, previewLoan } from "@/modules/portfolio/contracts";
import { getLoanDetail } from "@/modules/portfolio/loan-queries";
import { isoDate } from "@/shared/dates/dates";
import { AppError } from "@/shared/errors/app-error";
import type { IdempotencyKey } from "@/shared/ids/idempotency-key";
import { TestFixtures, createAdminClient } from "./helpers/auth";
import { createTestPool } from "./helpers/db";

// Barreras de la confirmación del contrato (F3-T4): zona horaria, idempotencia, aislamiento y bordes.

const pool = createTestPool();
const fixtures = new TestFixtures(pool, createAdminClient());
const deps = { db: pool };

afterAll(async () => {
  await fixtures.purge();
  await pool.end();
});

const key = () => randomUUID() as IdempotencyKey;
const noon = () => new Date("2026-10-13T17:00:00Z"); // 12:00 en Bogotá (UTC-5)

async function setup(funds = 5_000_000) {
  const businessId = await fixtures.business("Contratos barreras");
  const account = await fixtures.account({ role: "ADMIN_NEGOCIO", businessId });
  const admin: SessionContext = await loadSessionContext(account.userId, pool);
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

async function failureOf(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("se esperaba un AppError");
}

const loanCount = async (businessId: string) =>
  Number(
    (
      await pool.query<{ n: string }>(
        "select count(*) as n from public.loans where business_id = $1",
        [businessId],
      )
    ).rows[0]!.n,
  );

describe("fecha de desembolso en la zona del negocio", () => {
  // 2026-10-14 03:00 UTC = 13/10 22:00 en Bogotá: en UTC ya es el 14, para el negocio todavía es el 13.
  const lateNight = () => new Date("2026-10-14T03:00:00Z");

  it("«hoy» es la fecha del negocio, no la de UTC, en la vista previa y en la confirmación", async () => {
    const { admin, clientId } = await setup();

    const preview = await previewLoan(
      deps,
      admin,
      terms(clientId, { firstDueOn: isoDate("2026-10-13") }),
      lateNight,
    );
    expect(preview.disbursedOn).toBe("2026-10-13");

    const outcome = await confirmContract(
      deps,
      admin,
      { ...terms(clientId, { firstDueOn: isoDate("2026-10-13") }), idempotencyKey: key() },
      lateNight,
    );
    expect(outcome.result.disbursedOn).toBe("2026-10-13");
  });

  it("la primera cuota el mismo día del desembolso es válida; un día antes, no", async () => {
    const { admin, clientId } = await setup();
    const sameDay = terms(clientId, { firstDueOn: isoDate("2026-10-13") });

    expect((await previewLoan(deps, admin, sameDay, noon)).plan.installments[0]!.dueOn).toBe(
      "2026-10-13",
    );
    expect(
      await failureOf(
        previewLoan(deps, admin, terms(clientId, { firstDueOn: isoDate("2026-10-12") }), noon),
      ),
    ).toMatchObject({ code: "FIRST_DUE_BEFORE_DISBURSEMENT" });
  });
});

describe("idempotencia de la confirmación", () => {
  it("la misma clave con otro monto, interés, comentario o cuotas es un 409 y no cambia nada", async () => {
    const { businessId, admin, clientId } = await setup();
    const idempotencyKey = key();
    await confirmContract(
      deps,
      admin,
      { ...terms(clientId, { comment: "uno" }), idempotencyKey },
      noon,
    );

    for (const changed of [
      { principal: 999_999 },
      { interestBps: 2001 },
      { installmentCount: 11 },
      { frequency: "SEMANAL" },
      { comment: "otro" },
      { comment: undefined },
    ]) {
      expect(
        await failureOf(
          confirmContract(
            deps,
            admin,
            { ...terms(clientId, { comment: "uno", ...changed }), idempotencyKey },
            noon,
          ),
        ),
        JSON.stringify(changed),
      ).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED", status: 409 });
    }
    expect(await loanCount(businessId)).toBe(1);
  });

  it("reenviar en otro día devuelve el resultado guardado, idéntico, sin volver a validar fechas", async () => {
    const { businessId, admin, clientId } = await setup();
    const idempotencyKey = key();
    const first = await confirmContract(deps, admin, { ...terms(clientId), idempotencyKey }, noon);

    // Una semana después la primera cuota ya sería anterior al desembolso: el reenvío no ejecuta nada.
    const later = () => new Date("2026-10-20T17:00:00Z");
    const again = await confirmContract(deps, admin, { ...terms(clientId), idempotencyKey }, later);

    expect(again.replayed).toBe(true);
    expect(again.result).toEqual(first.result);
    expect(again.result.balance).toBe(first.result.balance);
    expect(again.result.movementId).toBe(first.result.movementId);
    expect(await loanCount(businessId)).toBe(1);
  });

  it("seis envíos simultáneos con la misma clave crean un solo préstamo", async () => {
    const { businessId, admin, clientId } = await setup();
    const idempotencyKey = key();

    const outcomes = await Promise.all(
      Array.from({ length: 6 }, () =>
        confirmContract(deps, admin, { ...terms(clientId), idempotencyKey }, noon),
      ),
    );

    expect(outcomes.filter((o) => !o.replayed)).toHaveLength(1);
    expect(new Set(outcomes.map((o) => o.result.loanId)).size).toBe(1);
    expect(await loanCount(businessId)).toBe(1);
  });
});

describe("aislamiento y autorización", () => {
  it("la vista previa de un cliente de otro negocio es «no encontrado»; el cobrador no consulta préstamos", async () => {
    const mine = await setup();
    const other = await setup();
    const collector = await loadSessionContext(
      (await fixtures.account({ role: "COBRADOR", businessId: mine.businessId })).userId,
      pool,
    );
    const foreign = await confirmContract(
      deps,
      other.admin,
      { ...terms(other.clientId), idempotencyKey: key() },
      noon,
    );

    expect(
      await failureOf(previewLoan(deps, mine.admin, terms(other.clientId), noon)),
    ).toMatchObject({
      code: "CLIENT_NOT_FOUND",
    });
    await expect(getLoanDetail(pool, collector, foreign.result.loanId)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(await getLoanDetail(pool, mine.admin, foreign.result.loanId)).toBeNull();
  });
});

describe("bordes", () => {
  it("la vista previa marca que alcanza con un saldo exactamente igual al principal", async () => {
    const exact = await setup(1_000_000);
    const short = await setup(999_999);

    expect(
      (await previewLoan(deps, exact.admin, terms(exact.clientId), noon)).sufficientFunds,
    ).toBe(true);
    expect(
      (await previewLoan(deps, short.admin, terms(short.clientId), noon)).sufficientFunds,
    ).toBe(false);
  });

  it("rechaza más cuotas que pesos por pagar y confirma un préstamo mensual con fin de mes", async () => {
    const { admin, clientId } = await setup();

    expect(
      await failureOf(
        confirmContract(
          deps,
          admin,
          {
            ...terms(clientId, { principal: 5, interestBps: 0, installmentCount: 6 }),
            idempotencyKey: key(),
          },
          noon,
        ),
      ),
    ).toMatchObject({ code: "INSTALLMENTS_EXCEED_TOTAL" });

    const monthly = await confirmContract(
      deps,
      admin,
      {
        ...terms(clientId, {
          frequency: "MENSUAL",
          installmentCount: 4,
          firstDueOn: isoDate("2027-01-31"),
        }),
        idempotencyKey: key(),
      },
      () => new Date("2026-12-15T17:00:00Z"),
    );
    const detail = await getLoanDetail(
      pool,
      admin,
      monthly.result.loanId,
      new Date("2026-12-15T17:00:00Z"),
    );
    expect(detail!.installments.map((i) => i.dueOn)).toEqual([
      "2027-01-31",
      "2027-02-28",
      "2027-03-31",
      "2027-04-30",
    ]);
  });

  it("la auditoría registra los datos que explican el préstamo", async () => {
    const { businessId, admin, clientId } = await setup();
    const outcome = await confirmContract(
      deps,
      admin,
      { ...terms(clientId), idempotencyKey: key() },
      noon,
    );

    const events = await pool.query<{
      action: string;
      entity_type: string;
      entity_id: string;
      summary: Record<string, unknown>;
    }>(
      `select action, entity_type, entity_id, summary from public.audit_events
        where business_id = $1 and action in ('PrestamoCreado','PrestamoDesembolsado','CuotasGeneradas')`,
      [businessId],
    );
    const byAction = Object.fromEntries(events.rows.map((e) => [e.action, e]));
    expect(byAction.PrestamoCreado).toMatchObject({
      entity_type: "loan",
      entity_id: outcome.result.loanId,
      summary: {
        principal: 1_000_000,
        interestBps: 2000,
        interest: 200_000,
        total: 1_200_000,
        frequency: "DIARIA",
        firstDueOn: "2026-10-14",
      },
    });
    expect(byAction.PrestamoDesembolsado?.summary).toMatchObject({
      amount: 1_000_000,
      movementId: outcome.result.movementId,
      disbursedOn: "2026-10-13",
    });
    expect(byAction.CuotasGeneradas?.summary).toMatchObject({
      count: 12,
      firstDueOn: "2026-10-14",
      lastDueOn: "2026-10-25",
      total: 1_200_000,
    });
  });
});
