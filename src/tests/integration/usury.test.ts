import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { registerCapitalIncome } from "@/modules/cash/commands";
import { getCashSummary } from "@/modules/cash/queries";
import { loadSessionContext, type SessionContext } from "@/modules/identity/session";
import { createClient } from "@/modules/portfolio/clients";
import { confirmContract, previewLoan } from "@/modules/portfolio/contracts";
import { previewRefinancing, refinanceLoan } from "@/modules/portfolio/refinancing";
import {
  currentUsuryRate,
  registerUsuryRate,
  usuryRateSchema,
  type UsuryRateInput,
} from "@/modules/portfolio/usury";
import { isoDate } from "@/shared/dates/dates";
import { AppError } from "@/shared/errors/app-error";
import type { IdempotencyKey } from "@/shared/ids/idempotency-key";
import { TestFixtures, createAdminClient } from "./helpers/auth";
import { attempt, createTestPool, withRollback } from "./helpers/db";

// Advertencia de usura (02 §2.3): el Super Admin registra la tasa vigente (historial de solo agregado) y
// confirmar un préstamo o una refinanciación por encima de ella exige marcar la advertencia; queda auditado.
//
// Aislamiento: la usura es de plataforma (afecta a todos los negocios). Las tasas de esta prueba rigen desde
// 2041 y se borran al final, así no alcanzan a las demás pruebas, que usan fechas de 2026.

const pool = createTestPool();
const fixtures = new TestFixtures(pool, createAdminClient());
const deps = { db: pool };
const registeredRates: string[] = [];

afterAll(async () => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    // Solo agregado: se desactivan los disparadores únicamente en esta limpieza (como en `purge`).
    await client.query("set local session_replication_role = replica");
    await client.query("delete from public.usury_rates where id = any($1)", [registeredRates]);
    await client.query("commit");
  } finally {
    client.release();
  }
  await fixtures.purge();
  await pool.end();
});

const key = () => randomUUID() as IdempotencyKey;
/** 15/01/2041 en Bogotá: posterior a la tasa de prueba. */
const later = () => new Date("2041-01-15T17:00:00Z");
/** 01/06/2001 en Bogotá: anterior a cualquier tasa real o de prueba. */
const before = () => new Date("2001-06-01T17:00:00Z");

async function superAdmin(): Promise<SessionContext> {
  const account = await fixtures.account({ role: "SUPER_ADMIN", businessId: null });
  return loadSessionContext(account.userId, pool);
}

async function register(actor: SessionContext, input: Record<string, string>) {
  const created = await registerUsuryRate(deps, actor, usuryRateSchema.parse(input));
  registeredRates.push(created.usuryRateId);
  return created;
}

async function setup() {
  const businessId = await fixtures.business("Usura");
  const account = await fixtures.account({ role: "ADMIN_NEGOCIO", businessId });
  const admin = await loadSessionContext(account.userId, pool);
  const client = await createClient(deps, admin, {
    name: "Ana",
    identification: randomUUID().slice(0, 8),
  });
  await registerCapitalIncome(deps, admin, { idempotencyKey: key(), amount: 5_000_000 });
  return { businessId, admin, clientId: client.id };
}

/** 12 cuotas mensuales de un préstamo de $1.000.000: 14 % da 28,09 % E.A. y 15 % da 30,27 % E.A. */
const monthly = (clientId: string, interestBps: number, firstDueOn: string) => ({
  clientId,
  principal: 1_000_000,
  interestBps,
  frequency: "MENSUAL" as const,
  installmentCount: 12,
  firstDueOn: isoDate(firstDueOn),
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

const count = async (table: string, businessId: string) =>
  Number(
    (
      await pool.query<{ n: string }>(
        `select count(*) as n from public.${table} where business_id = $1`,
        [businessId],
      )
    ).rows[0]!.n,
  );

const confirmedSummary = async (contractId: string) =>
  (
    await pool.query<{ summary: { usury: Record<string, unknown> } }>(
      "select summary from public.audit_events where action = 'ContratoConfirmado' and entity_id = $1",
      [contractId],
    )
  ).rows[0]!.summary;

describe("sin tasa de usura registrada", () => {
  it("la vista previa lo indica y confirmar no exige nada", async () => {
    const s = await setup();
    const terms = monthly(s.clientId, 2000, "2001-07-01");

    const preview = await previewLoan(deps, s.admin, terms, before);
    expect(preview.usury).toEqual({
      effectiveAnnualRateBps: expect.any(Number),
      effectiveAnnualRateCapped: false,
      usuryRate: null,
      exceeds: false,
    });

    const confirmed = await confirmContract(
      deps,
      s.admin,
      { ...terms, idempotencyKey: key() },
      before,
    );
    expect((await confirmedSummary(confirmed.result.contractId)).usury).toMatchObject({
      usuryRateId: null,
      usuryRateBps: null,
      confirmedWithUsuryWarning: false,
    });
  });
});

describe("registro de la tasa (Super Admin)", () => {
  it("se registra con auditoría; solo el Super Admin; datos inválidos son 400", async () => {
    const root = await superAdmin();
    const created = await register(root, {
      rate: "28,59",
      validFrom: "2041-01-01",
      source: "Resolución de prueba de la Superintendencia Financiera",
    });
    const audit = await pool.query<{ summary: Record<string, unknown> }>(
      "select summary from public.audit_events where action = 'TasaUsuraRegistrada' and entity_id = $1",
      [created.usuryRateId],
    );
    expect(audit.rows[0]?.summary).toMatchObject({ rateBps: 2859, validFrom: "2041-01-01" });

    const { admin } = await setup();
    const input: UsuryRateInput = usuryRateSchema.parse({
      rate: "30",
      validFrom: "2041-01-01",
      source: "x",
    });
    expect(await failureOf(registerUsuryRate(deps, admin, input))).toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    });

    for (const invalid of [
      { rate: "28,595", validFrom: "2041-01-01", source: "x" },
      { rate: "0", validFrom: "2041-01-01", source: "x" },
      { rate: "abc", validFrom: "2041-01-01", source: "x" },
      { rate: "28,59", validFrom: "2041-02-30", source: "x" },
      { rate: "28,59", validFrom: "2041-01-01", source: "  " },
    ]) {
      expect(usuryRateSchema.safeParse(invalid).success, JSON.stringify(invalid)).toBe(false);
    }
  });

  it("la vigente es la más reciente con fecha no posterior; a igual fecha, la última registrada", async () => {
    const root = await superAdmin();
    await register(root, { rate: "27", validFrom: "2042-01-01", source: "Primera" });
    const correction = await register(root, {
      rate: "26,5",
      validFrom: "2042-01-01",
      source: "Corrección",
    });
    await register(root, { rate: "25", validFrom: "2042-02-01", source: "Siguiente" });

    expect(await currentUsuryRate(pool, isoDate("2041-12-31"))).toMatchObject({ rateBps: 2859 });
    expect(await currentUsuryRate(pool, isoDate("2042-01-20"))).toMatchObject({
      id: correction.usuryRateId,
      rateBps: 2650,
      source: "Corrección",
    });
    expect(await currentUsuryRate(pool, isoDate("2042-02-01"))).toMatchObject({ rateBps: 2500 });
  });

  it("el historial no se edita ni se borra", async () => {
    await withRollback(pool, async (client) => {
      const id = registeredRates[0]!;
      for (const statement of [
        `update public.usury_rates set rate_bps = 1 where id = '${id}'`,
        `delete from public.usury_rates where id = '${id}'`,
      ]) {
        expect(await attempt(client, statement), statement).not.toBeNull();
      }
    });
  });
});

describe("advertencia al confirmar un contrato nuevo (usura de 28,59 % desde 2041-01-01)", () => {
  it("por debajo de la usura no se advierte", async () => {
    const s = await setup();
    const preview = await previewLoan(
      deps,
      s.admin,
      monthly(s.clientId, 1400, "2041-02-15"),
      later,
    );
    expect(preview.usury).toMatchObject({
      effectiveAnnualRateBps: 2809,
      usuryRate: { rateBps: 2859, validFrom: "2041-01-01" },
      exceeds: false,
    });
  });

  it("por encima: sin la marca se rechaza con 409 sin dejar nada; con ella se confirma y se audita", async () => {
    const s = await setup();
    const terms = monthly(s.clientId, 1500, "2041-02-15");

    const preview = await previewLoan(deps, s.admin, terms, later);
    expect(preview.usury).toMatchObject({ effectiveAnnualRateBps: 3027, exceeds: true });

    for (const acknowledgeUsuryWarning of [undefined, false]) {
      const failure = await failureOf(
        confirmContract(
          deps,
          s.admin,
          { ...terms, acknowledgeUsuryWarning, idempotencyKey: key() },
          later,
        ),
      );
      expect(failure).toMatchObject({ code: "USURY_WARNING_NOT_ACKNOWLEDGED", status: 409 });
      expect(failure.message).toContain("30,27 % E.A.");
      expect(failure.message).toContain("28,59 % E.A.");
    }
    expect(await count("contracts", s.businessId)).toBe(0);
    expect((await getCashSummary(pool, s.admin)).balance).toBe(5_000_000);

    const confirmed = await confirmContract(
      deps,
      s.admin,
      { ...terms, acknowledgeUsuryWarning: true, idempotencyKey: key() },
      later,
    );
    expect((await confirmedSummary(confirmed.result.contractId)).usury).toEqual({
      effectiveAnnualRateBps: 3027,
      effectiveAnnualRateCapped: false,
      usuryRateId: preview.usury.usuryRate!.id,
      usuryRateBps: 2859,
      confirmedWithUsuryWarning: true,
    });
  });
});

describe("advertencia al refinanciar", () => {
  it("la refinanciación por encima de la usura también exige la marca y la audita", async () => {
    const s = await setup();
    // Préstamo sin interés: no supera la usura y se confirma sin marca.
    const original = await confirmContract(
      deps,
      s.admin,
      {
        clientId: s.clientId,
        principal: 300_000,
        interestBps: 0,
        frequency: "DIARIA",
        installmentCount: 3,
        firstDueOn: isoDate("2041-01-16"),
        idempotencyKey: key(),
      },
      later,
    );
    const loanId = original.result.loanId;
    const terms = {
      additionalAmount: 0,
      interestBps: 1500,
      frequency: "MENSUAL" as const,
      installmentCount: 12,
      firstDueOn: isoDate("2041-02-15"),
    };

    const preview = await previewRefinancing(deps, s.admin, loanId, terms, later);
    expect(preview.usury.exceeds).toBe(true);
    expect(preview.usury.effectiveAnnualRateBps).toBeGreaterThan(2859);

    expect(
      await failureOf(
        refinanceLoan(deps, s.admin, { ...terms, loanId, idempotencyKey: key() }, later),
      ),
    ).toMatchObject({ code: "USURY_WARNING_NOT_ACKNOWLEDGED", status: 409 });
    expect(await count("refinancings", s.businessId)).toBe(0);

    const refinanced = await refinanceLoan(
      deps,
      s.admin,
      { ...terms, loanId, acknowledgeUsuryWarning: true, idempotencyKey: key() },
      later,
    );
    const contract = await pool.query<{ contract_id: string }>(
      "select contract_id from public.loans where id = $1",
      [refinanced.result.newLoanId],
    );
    expect((await confirmedSummary(contract.rows[0]!.contract_id)).usury).toMatchObject({
      effectiveAnnualRateBps: preview.usury.effectiveAnnualRateBps,
      usuryRateBps: 2859,
      confirmedWithUsuryWarning: true,
    });
  });
});
