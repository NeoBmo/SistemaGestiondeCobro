import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { listClients, getClientDetail } from "@/modules/portfolio/client-queries";
import { createClient, deleteClient } from "@/modules/portfolio/clients";
import { importLoan } from "@/modules/portfolio/imports";
import { loadSessionContext, type SessionContext } from "@/modules/identity/session";
import { isoDate } from "@/shared/dates/dates";
import { AppError } from "@/shared/errors/app-error";
import type { IdempotencyKey } from "@/shared/ids/idempotency-key";
import { TestFixtures, createAdminClient } from "./helpers/auth";
import { createTestPool, withRollback } from "./helpers/db";

// Decisiones del 2026-10-24 (02 §2.1 y §2.3): identificación única en su forma normalizada, búsqueda
// sin tildes ni mayúsculas, eliminación de un cliente sin historial y topes técnicos del préstamo en BD.

const pool = createTestPool();
const fixtures = new TestFixtures(pool, createAdminClient());
const deps = { db: pool };

afterAll(async () => {
  await fixtures.purge();
  await pool.end();
});

async function newBusiness(): Promise<{ businessId: string; admin: SessionContext }> {
  const businessId = await fixtures.business("Clientes decisiones");
  const account = await fixtures.account({ role: "ADMIN_NEGOCIO", businessId });
  return { businessId, admin: await loadSessionContext(account.userId, pool) };
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

async function sqlFailureOf(
  promise: Promise<unknown>,
): Promise<{ code?: string; constraint?: string }> {
  try {
    await promise;
  } catch (error) {
    return error as { code?: string; constraint?: string };
  }
  throw new Error("se esperaba un error de la base de datos");
}

const events = async (businessId: string, action: string) =>
  (
    await pool.query<{
      actor_id: string;
      entity_id: string;
      result: string;
      summary: Record<string, unknown>;
    }>(
      "select actor_id, entity_id, result, summary from public.audit_events where business_id = $1 and action = $2 order by occurred_at",
      [businessId, action],
    )
  ).rows;

const clientExists = async (clientId: string) =>
  (await pool.query("select 1 from public.clients where id = $1", [clientId])).rowCount === 1;

async function withImportedLoan(admin: SessionContext, clientId: string): Promise<void> {
  await importLoan(
    deps,
    admin,
    {
      clientId,
      originalDate: isoDate("2026-08-01"),
      principal: 1_000_000,
      interestBps: 2000,
      frequency: "SEMANAL",
      pendingBalance: 700_000,
      installmentCount: 7,
      nextDueOn: isoDate("2026-10-20"),
      idempotencyKey: randomUUID() as IdempotencyKey,
    },
    () => new Date("2026-10-13T17:00:00Z"),
  );
}

describe("identificación única en su forma normalizada", () => {
  it("ABC-1, abc 1 y abc1 son el mismo documento: 409, se guarda tal como se escribió", async () => {
    const { businessId, admin } = await newBusiness();
    const first = await createClient(deps, admin, { name: "Ana", identification: "ABC-1" });
    expect(first.identification).toBe("ABC-1");

    for (const identification of ["abc 1", "abc1", "A.B.C.1", "a/b_c#1"]) {
      expect(
        await failureOf(createClient(deps, admin, { name: "Otra", identification })),
        identification,
      ).toMatchObject({ code: "CLIENT_IDENTIFICATION_EXISTS", status: 409 });
    }
    expect(await events(businessId, "ClienteCreado")).toHaveLength(1);

    // Otro negocio sí puede tenerlo.
    const other = await newBusiness();
    expect(
      await createClient(deps, other.admin, { name: "Ana", identification: "abc1" }),
    ).toBeTruthy();
  });

  it("compara en NFC y conserva tildes y eñes: «Ñandú-1» choca con «ñandú 1» en NFD, no con «nandu1»", async () => {
    const { admin } = await newBusiness();
    await createClient(deps, admin, { name: "Ana", identification: "Ñandú-1" });

    // La misma palabra escrita con caracteres combinados (NFD) es el mismo documento.
    expect(
      await failureOf(
        createClient(deps, admin, { name: "Otra", identification: "ñandú 1".normalize("NFD") }),
      ),
    ).toMatchObject({ code: "CLIENT_IDENTIFICATION_EXISTS" });
    // Sin tilde ni eñe es otro documento: la normalización no quita letras ni acentos.
    expect(
      await createClient(deps, admin, { name: "Otra", identification: "nandu1" }),
    ).toBeTruthy();
  });

  it("dos altas simultáneas con la misma identificación normalizada: una se crea y la otra es un 409", async () => {
    const { businessId, admin } = await newBusiness();

    const outcomes = await Promise.allSettled([
      createClient(deps, admin, { name: "Ana", identification: "CC-555" }),
      createClient(deps, admin, { name: "Ana", identification: "cc555" }),
    ]);

    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((o) => o.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "CLIENT_IDENTIFICATION_EXISTS", status: 409 });
    expect(await events(businessId, "ClienteCreado")).toHaveLength(1);
  });

  it("la base rechaza una identificación sin letras ni dígitos", async () => {
    const { businessId, admin } = await newBusiness();

    const error = await sqlFailureOf(
      pool.query(
        "insert into public.clients (business_id, name, identification, created_by) values ($1, 'Ana', '--', $2)",
        [businessId, admin.userId],
      ),
    );

    expect(error).toMatchObject({
      code: "23514",
      constraint: "clients_identification_key_not_empty",
    });
  });
});

describe("búsqueda sin tildes ni mayúsculas", () => {
  it("andres encuentra Andrés por nombre, sobrenombre e identificación", async () => {
    const one = await newBusiness();
    const two = await newBusiness();
    await createClient(deps, one.admin, {
      name: "Andrés Pérez",
      nickname: "El Ñoño",
      identification: "CÉD-77",
      phone: "3001112222",
    });
    await createClient(deps, one.admin, { name: "Zoila", identification: "10" });
    await createClient(deps, two.admin, { name: "Andrés Ajeno", identification: "20" });

    for (const [term, expected] of [
      ["andres", ["Andrés Pérez"]],
      ["ANDRÉS", ["Andrés Pérez"]],
      ["perez", ["Andrés Pérez"]],
      ["nono", ["Andrés Pérez"]],
      ["ced-77", ["Andrés Pérez"]],
      ["1112", ["Andrés Pérez"]],
      ["zoila10", []], // un término no coincide a caballo entre dos campos
      ["\\", []],
      ["%", []],
      ["_", []],
    ] as const) {
      const found = await listClients(pool, one.admin, term);
      expect(
        found.clients.map((c) => c.name),
        term,
      ).toEqual(expected);
    }
  });

  it("la búsqueda puede usar el índice trigram de search_text", async () => {
    const plan = await withRollback(pool, async (client) => {
      await client.query("set local enable_seqscan = off");
      const { rows } = await client.query<{ "QUERY PLAN": string }>(
        `explain select id from public.clients
          where search_text like '%' || private.normalize_search('Andrés') || '%'`,
      );
      return rows.map((row) => row["QUERY PLAN"]).join("\n");
    });

    expect(plan).toContain("clients_search_text_trgm_idx");
  });
});

describe("eliminación de un cliente sin historial", () => {
  it("elimina al cliente sin contratos y audita ClienteEliminado sin datos personales", async () => {
    const { businessId, admin } = await newBusiness();
    const client = await createClient(deps, admin, {
      name: "Ana Captura Errónea",
      identification: "ERR-123",
      phone: "3009998888",
    });

    expect((await getClientDetail(pool, admin, client.id))?.deletionBlocker).toBeNull();
    expect(await deleteClient(deps, admin, client.id)).toEqual({ clientId: client.id });

    expect(await clientExists(client.id)).toBe(false);
    const deleted = await events(businessId, "ClienteEliminado");
    expect(deleted).toEqual([
      { actor_id: admin.userId, entity_id: client.id, result: "OK", summary: {} },
    ]);
    const serialized = JSON.stringify(deleted);
    for (const value of ["Ana", "ERR-123", "3009998888"]) {
      expect(serialized, value).not.toContain(value);
    }
    // La identificación queda libre para un alta correcta.
    expect(await createClient(deps, admin, { name: "Ana", identification: "err123" })).toBeTruthy();
  });

  it("un cliente con un contrato o préstamo no se elimina: 409 y sigue intacto", async () => {
    const { businessId, admin } = await newBusiness();
    const client = await createClient(deps, admin, { name: "Ana", identification: "1" });
    await withImportedLoan(admin, client.id);

    expect((await getClientDetail(pool, admin, client.id))?.deletionBlocker).toBe("HAS_CONTRACTS");
    expect(await failureOf(deleteClient(deps, admin, client.id))).toMatchObject({
      code: "CLIENT_HAS_HISTORY",
      status: 409,
    });
    expect(await clientExists(client.id)).toBe(true);
    expect(await events(businessId, "ClienteEliminado")).toEqual([]);

    // Tampoco saltándose el servicio: el trigger lo impide en la base.
    expect(
      await sqlFailureOf(pool.query("delete from public.clients where id = $1", [client.id])),
    ).toMatchObject({ code: "23001" });
    expect(await clientExists(client.id)).toBe(true);
  });

  it("un cliente con historial de ruta no se elimina: 409", async () => {
    const { businessId, admin } = await newBusiness();
    const client = await createClient(deps, admin, { name: "Ana", identification: "1" });
    const collectorUser = (await fixtures.account({ role: "COBRADOR", businessId })).userId;
    const collectorId = (
      await pool.query<{ id: string }>(
        "insert into public.collectors (business_id, user_id, name, created_by) values ($1, $2, 'C', $3) returning id",
        [businessId, collectorUser, admin.userId],
      )
    ).rows[0]!.id;
    const routeId = (
      await pool.query<{ id: string }>(
        "insert into public.routes (business_id, collector_id, name, started_on, created_by) values ($1, $2, 'R', current_date, $3) returning id",
        [businessId, collectorId, admin.userId],
      )
    ).rows[0]!.id;
    await pool.query(
      "insert into public.client_assignments (business_id, client_id, route_id, collector_id, created_by) values ($1, $2, $3, $4, $5)",
      [businessId, client.id, routeId, collectorId, admin.userId],
    );

    expect((await getClientDetail(pool, admin, client.id))?.deletionBlocker).toBe(
      "HAS_COLLECTION_HISTORY",
    );
    expect(await failureOf(deleteClient(deps, admin, client.id))).toMatchObject({
      code: "CLIENT_HAS_HISTORY",
      status: 409,
    });
    expect(await clientExists(client.id)).toBe(true);
  });

  it("el cliente de otro negocio es «no encontrado»; un cobrador recibe 403 con evento RECHAZADO", async () => {
    const mine = await newBusiness();
    const other = await newBusiness();
    const foreign = await createClient(deps, other.admin, { name: "Ajeno", identification: "9" });

    expect(await failureOf(deleteClient(deps, mine.admin, foreign.id))).toMatchObject({
      code: "CLIENT_NOT_FOUND",
      status: 404,
    });
    expect(await clientExists(foreign.id)).toBe(true);

    const collector = await loadSessionContext(
      (await fixtures.account({ role: "COBRADOR", businessId: other.businessId })).userId,
      pool,
    );
    expect(await failureOf(deleteClient(deps, collector, foreign.id))).toMatchObject({
      code: "FORBIDDEN",
    });
    expect(await clientExists(foreign.id)).toBe(true);
    expect(await events(other.businessId, "ClienteEliminado")).toEqual([
      expect.objectContaining({ actor_id: collector.userId, result: "RECHAZADO" }),
    ]);
  });
});

describe("topes técnicos del préstamo en la base de datos (ADR 0007)", () => {
  async function insertLoan(overrides: { interestBps: number; installmentCount: number }) {
    const { businessId, admin } = await newBusiness();
    const client = await createClient(deps, admin, { name: "Ana", identification: "1" });
    return withRollback(pool, async (tx) => {
      const contractId = (
        await tx.query<{ id: string }>(
          `insert into public.contracts (business_id, client_id, number, origin, created_by)
           values ($1, $2, 'CT-999999', 'IMPORTADO', $3) returning id`,
          [businessId, client.id, admin.userId],
        )
      ).rows[0]!.id;
      const principal = 1000;
      // Mismo redondeo half-up que exige `loans_interest_formula`, para que solo falle el tope.
      const interest = Number(
        (BigInt(principal) * BigInt(overrides.interestBps) * 2n + 10000n) / 20000n,
      );
      return sqlFailureOf(
        tx.query(
          `insert into public.loans
             (business_id, contract_id, principal_amount, interest_bps, interest_amount, total_amount,
              scheduled_amount, disbursed_on, first_due_on, frequency, installment_count, created_by)
           values ($1, $2, $3, $4, $5, $6, $6, current_date, current_date, 'DIARIA', $7, $8)`,
          [
            businessId,
            contractId,
            principal,
            overrides.interestBps,
            interest,
            principal + interest,
            overrides.installmentCount,
            admin.userId,
          ],
        ),
      );
    });
  }

  it("rechaza un interés mayor que 1.000.000 puntos básicos", async () => {
    expect(await insertLoan({ interestBps: 1_000_001, installmentCount: 1 })).toMatchObject({
      code: "23514",
      constraint: "loans_interest_bps_max",
    });
  });

  it("rechaza más de 1.000 cuotas", async () => {
    expect(await insertLoan({ interestBps: 0, installmentCount: 1001 })).toMatchObject({
      code: "23514",
      constraint: "loans_installment_count_max",
    });
  });
});
