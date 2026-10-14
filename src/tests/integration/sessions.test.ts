import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { assignClient } from "@/modules/collections/assignments";
import { registerAttempt } from "@/modules/collections/attempts";
import { createCollector, deactivateCollector } from "@/modules/collections/collectors";
import { closeRoute, createRoute } from "@/modules/collections/routes";
import {
  openSession,
  registerCollectorExpense,
  transferFund,
} from "@/modules/collections/sessions";
import { registerCapitalIncome } from "@/modules/cash/commands";
import { getCashSummary } from "@/modules/cash/queries";
import { loadSessionContext, type SessionContext } from "@/modules/identity/session";
import { createClient } from "@/modules/portfolio/clients";
import { confirmContract } from "@/modules/portfolio/contracts";
import { getLoanDetail } from "@/modules/portfolio/loan-queries";
import {
  registerCollectorPayment,
  registerPayment,
  reversePayment,
} from "@/modules/portfolio/payments";
import { isoDate } from "@/shared/dates/dates";
import { AppError } from "@/shared/errors/app-error";
import type { IdempotencyKey } from "@/shared/ids/idempotency-key";
import { TEST_EMAIL_DOMAIN, TestFixtures, createAdminClient } from "./helpers/auth";
import { createTestPool } from "./helpers/db";

// F5-T5 (02 §3.1, §4.4, §5, §8; ADR 0009): abrir jornada, fondo operativo, cobros y gastos del cobrador
// contra su Caja Menor, intentos de cobro y reverso de un cobro de jornada por el Admin.

const pool = createTestPool();
const admin = createAdminClient();
const fixtures = new TestFixtures(pool, admin);
const deps = { db: pool };
const collectorDeps = { db: pool, admin, syntheticEmailDomain: TEST_EMAIL_DOMAIN };
const key = () => randomUUID() as IdempotencyKey;
const unique = () => randomUUID().slice(0, 8);
const now = () => new Date("2026-10-13T17:00:00Z");

afterAll(async () => {
  await fixtures.purge();
  await pool.end();
});

type World = Awaited<ReturnType<typeof world>>;

/** Negocio con $2.000.000 en la Mayor, un cobrador con ruta y un cliente asignado con un préstamo de $300.000. */
async function world() {
  const businessId = await fixtures.business("Jornada");
  const account = await fixtures.account({ role: "ADMIN_NEGOCIO", businessId });
  const adminCtx: SessionContext = await loadSessionContext(account.userId, pool);
  await registerCapitalIncome(deps, adminCtx, { idempotencyKey: key(), amount: 2_000_000 });

  const created = await createCollector(collectorDeps, adminCtx, {
    name: "Carlos",
    username: `cob.${unique()}`,
  });
  fixtures.track({ userId: created.userId });
  // El cobrador ya cambió su contraseña temporal (los comandos exigen la cuenta activa).
  await pool.query("update public.profiles set status = 'ACTIVO' where id = $1", [created.userId]);
  const collector = await loadSessionContext(created.userId, pool);
  const route = await createRoute(deps, adminCtx, {
    collectorId: created.collectorId,
    name: "Norte",
  });

  const client = await createClient(deps, adminCtx, { name: "Ana", identification: unique() });
  await assignClient(deps, adminCtx, { clientId: client.id, routeId: route.routeId });
  const loan = await confirmContract(
    deps,
    adminCtx,
    {
      clientId: client.id,
      principal: 300_000,
      interestBps: 0,
      frequency: "DIARIA",
      installmentCount: 3,
      firstDueOn: isoDate("2026-10-14"),
      idempotencyKey: key(),
    },
    now,
  );
  return {
    businessId,
    admin: adminCtx,
    collector,
    collectorId: created.collectorId,
    routeId: route.routeId,
    clientId: client.id,
    loanId: loan.result.loanId,
  };
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

const open = async (w: World) =>
  (await openSession(deps, w.collector, { idempotencyKey: key() }, now)).result.sessionId;
const fund = (w: World, sessionId: string, amount: number) =>
  transferFund(deps, w.admin, { idempotencyKey: key(), sessionId, amount });
const sessionBalance = async (sessionId: string) =>
  Number(
    (
      await pool.query<{ n: string }>(
        `select coalesce(sum(case direction when 'ENTRADA' then amount else -amount end), 0)::text as n
           from public.cash_movements where session_id = $1`,
        [sessionId],
      )
    ).rows[0]!.n,
  );

describe("abrir jornada", () => {
  it("el cobrador abre una jornada en cero con la fecha del negocio; solo una a la vez", async () => {
    const w = await world();

    const first = await openSession(deps, w.collector, { idempotencyKey: key() }, now);
    expect(first.result.businessDate).toBe("2026-10-13");
    expect(await sessionBalance(first.result.sessionId)).toBe(0);
    expect(
      await failureOf(openSession(deps, w.collector, { idempotencyKey: key() }, now)),
    ).toMatchObject({ code: "SESSION_ALREADY_OPEN", status: 409 });

    const events = await pool.query(
      "select 1 from public.audit_events where business_id = $1 and action = 'JornadaAbierta' and entity_id = $2",
      [w.businessId, first.result.sessionId],
    );
    expect(events.rowCount).toBe(1);
  });

  it("es idempotente y el Admin no abre jornadas (RECHAZADO)", async () => {
    const w = await world();
    const idempotencyKey = key();

    const first = await openSession(deps, w.collector, { idempotencyKey }, now);
    const again = await openSession(deps, w.collector, { idempotencyKey }, now);
    expect(again.replayed).toBe(true);
    expect(again.result.sessionId).toBe(first.result.sessionId);

    expect(
      await failureOf(openSession(deps, w.admin, { idempotencyKey: key() }, now)),
    ).toMatchObject({
      status: 403,
    });
    const rejected = await pool.query(
      "select 1 from public.audit_events where business_id = $1 and action = 'AbrirJornada' and result = 'RECHAZADO'",
      [w.businessId],
    );
    expect(rejected.rowCount).toBeGreaterThan(0);
  });

  it("un cobrador desactivado no abre jornada", async () => {
    const w = await world();
    await assignAway(w);
    await closeRoute(deps, w.admin, w.routeId);
    await deactivateCollector(collectorDeps, w.admin, w.collectorId);

    expect(
      await failureOf(openSession(deps, w.collector, { idempotencyKey: key() }, now)),
    ).toMatchObject({
      status: 403,
    });
  });
});

/** Mueve a todos los clientes de la ruta a otra ruta (de otro cobrador) para poder cerrarla. */
async function assignAway(w: World) {
  const created = await createCollector(collectorDeps, w.admin, {
    name: "Otro",
    username: `cob.${unique()}`,
  });
  fixtures.track({ userId: created.userId });
  const route = await createRoute(deps, w.admin, { collectorId: created.collectorId, name: "Sur" });
  await assignClient(deps, w.admin, { clientId: w.clientId, routeId: route.routeId });
}

describe("fondo operativo", () => {
  it("el Admin transfiere fondo (varias veces) y las dos cajas cuadran; sin saldo en la Mayor se rechaza", async () => {
    const w = await world();
    const sessionId = await open(w);
    const before = (await getCashSummary(pool, w.admin)).balance;

    const first = await fund(w, sessionId, 100_000);
    const second = await fund(w, sessionId, 50_000);

    expect(first.result).toMatchObject({ balance: before - 100_000, sessionBalance: 100_000 });
    expect(second.result).toMatchObject({ balance: before - 150_000, sessionBalance: 150_000 });
    expect((await getCashSummary(pool, w.admin)).balance).toBe(before - 150_000);

    expect(await failureOf(fund(w, sessionId, before))).toMatchObject({
      code: "INSUFFICIENT_FUNDS",
    });
    expect(await sessionBalance(sessionId)).toBe(150_000);
    // El fondo queda en el historial como un par de movimientos con la misma jornada.
    const audit = await pool.query(
      "select 1 from public.audit_events where business_id = $1 and action = 'FondoOperativoTransferido'",
      [w.businessId],
    );
    expect(audit.rowCount).toBe(2);
  });

  it("solo a una jornada abierta, del negocio y por el Admin; es idempotente", async () => {
    const w = await world();
    const other = await world();
    const sessionId = await open(w);
    const otherSession = await open(other);
    const idempotencyKey = key();

    await transferFund(deps, w.admin, { idempotencyKey, sessionId, amount: 1000 });
    const again = await transferFund(deps, w.admin, { idempotencyKey, sessionId, amount: 1000 });
    expect(again.replayed).toBe(true);
    expect(await sessionBalance(sessionId)).toBe(1000);

    expect(await failureOf(fund(w, otherSession, 1000))).toMatchObject({
      code: "SESSION_NOT_FOUND",
      status: 404,
    });
    expect(
      await failureOf(
        transferFund(deps, w.collector, { idempotencyKey: key(), sessionId, amount: 1 }),
      ),
    ).toMatchObject({ status: 403 });
  });
});

describe("cobros del cobrador", () => {
  it("entra a su jornada (no a la Mayor), reduce la deuda y se explica por cuota; solo su cartera", async () => {
    const w = await world();
    const sessionId = await open(w);
    await fund(w, sessionId, 100_000);
    const mayorBefore = (await getCashSummary(pool, w.admin)).balance;

    const paid = await registerCollectorPayment(deps, w.collector, {
      idempotencyKey: key(),
      loanId: w.loanId,
      amount: 150_000,
    });

    expect(paid.result).toMatchObject({
      amount: 150_000,
      balance: 250_000,
      loanPendingBalance: 150_000,
    });
    expect(paid.result.applications).toEqual([
      { installmentNumber: 1, applied: 100_000, pendingAfter: 0 },
      { installmentNumber: 2, applied: 50_000, pendingAfter: 50_000 },
    ]);
    expect(await sessionBalance(sessionId)).toBe(250_000);
    expect((await getCashSummary(pool, w.admin)).balance).toBe(mayorBefore);
    const movement = await pool.query<{ session_id: string; created_by: string }>(
      "select session_id, created_by from public.cash_movements where id = $1",
      [paid.result.movementId],
    );
    expect(movement.rows[0]).toEqual({ session_id: sessionId, created_by: w.collector.userId });
  });

  it("exige jornada abierta, rechaza clientes ajenos o reasignados y el exceso, y es idempotente", async () => {
    const w = await world();
    const idempotencyKey = key();
    const body = { loanId: w.loanId, amount: 10_000 };

    expect(
      await failureOf(
        registerCollectorPayment(deps, w.collector, { idempotencyKey: key(), ...body }),
      ),
    ).toMatchObject({ code: "NO_OPEN_SESSION", status: 409 });

    const sessionId = await open(w);
    await registerCollectorPayment(deps, w.collector, { idempotencyKey, ...body });
    const again = await registerCollectorPayment(deps, w.collector, { idempotencyKey, ...body });
    expect(again.replayed).toBe(true);
    expect(await sessionBalance(sessionId)).toBe(10_000);

    expect(
      await failureOf(
        registerCollectorPayment(deps, w.collector, {
          idempotencyKey: key(),
          loanId: w.loanId,
          amount: 1_000_000,
        }),
      ),
    ).toMatchObject({ code: "PAYMENT_EXCEEDS_BALANCE" });

    // Otro negocio: el préstamo no existe para este cobrador.
    const other = await world();
    expect(
      await failureOf(
        registerCollectorPayment(deps, w.collector, {
          idempotencyKey: key(),
          loanId: other.loanId,
          amount: 1000,
        }),
      ),
    ).toMatchObject({ code: "LOAN_NOT_FOUND", status: 404 });

    // Reasignado a otro cobrador, ya no es de su cartera.
    await assignAway(w);
    expect(
      await failureOf(
        registerCollectorPayment(deps, w.collector, { idempotencyKey: key(), ...body }),
      ),
    ).toMatchObject({ code: "LOAN_NOT_FOUND", status: 404 });
    expect(await sessionBalance(sessionId)).toBe(10_000);
  });

  it("el Admin no cobra por la ruta del cobrador y sigue cobrando contra la Mayor", async () => {
    const w = await world();
    expect(
      await failureOf(
        registerCollectorPayment(deps, w.admin, {
          idempotencyKey: key(),
          loanId: w.loanId,
          amount: 1,
        }),
      ),
    ).toMatchObject({ status: 403 });
    const mayorBefore = (await getCashSummary(pool, w.admin)).balance;
    await registerPayment(deps, w.admin, {
      idempotencyKey: key(),
      loanId: w.loanId,
      amount: 10_000,
    });
    expect((await getCashSummary(pool, w.admin)).balance).toBe(mayorBefore + 10_000);
  });

  it("el Admin reversa un cobro de jornada abierta: sale de la Caja Menor, no de la Mayor; no si la deja negativa", async () => {
    const w = await world();
    const sessionId = await open(w);
    await fund(w, sessionId, 50_000);
    const paid = await registerCollectorPayment(deps, w.collector, {
      idempotencyKey: key(),
      loanId: w.loanId,
      amount: 40_000,
    });
    const mayorBefore = (await getCashSummary(pool, w.admin)).balance;

    // El cobrador ya gastó parte del dinero cobrado: el reverso dejaría la jornada en negativo.
    await registerCollectorExpense(deps, w.collector, {
      idempotencyKey: key(),
      amount: 80_000,
      category: "GASOLINA",
    });
    expect(
      await failureOf(
        reversePayment(deps, w.admin, {
          idempotencyKey: key(),
          paymentId: paid.result.paymentId,
          reason: "Error",
        }),
      ),
    ).toMatchObject({ code: "INSUFFICIENT_FUNDS" });

    // Con saldo suficiente sí: sale de la jornada y la deuda se restaura.
    await fund(w, sessionId, 100_000);
    const reversed = await reversePayment(deps, w.admin, {
      idempotencyKey: key(),
      paymentId: paid.result.paymentId,
      reason: "Error",
    });
    expect(reversed.result.loanPendingBalance).toBe(300_000);
    expect(await sessionBalance(sessionId)).toBe(50_000 + 40_000 - 80_000 + 100_000 - 40_000);
    expect((await getCashSummary(pool, w.admin)).balance).toBe(mayorBefore - 100_000);
    expect((await getLoanDetail(pool, w.admin, w.loanId, now()))!.pendingBalance).toBe(300_000);
  });
});

describe("gastos del cobrador", () => {
  it("reduce el saldo esperado de su jornada; sin saldo se rechaza; sin jornada abierta no hay gasto", async () => {
    const w = await world();
    expect(
      await failureOf(
        registerCollectorExpense(deps, w.collector, {
          idempotencyKey: key(),
          amount: 1000,
          category: "GASOLINA",
        }),
      ),
    ).toMatchObject({ code: "NO_OPEN_SESSION" });

    const sessionId = await open(w);
    await fund(w, sessionId, 100_000);
    const spent = await registerCollectorExpense(
      deps,
      w.collector,
      { idempotencyKey: key(), amount: 30_000, category: "ALIMENTACION", note: "Almuerzo" },
      now,
    );
    expect(spent.result.sessionBalance).toBe(70_000);
    expect(await sessionBalance(sessionId)).toBe(70_000);
    const expense = await pool.query<{ session_id: string; spent_on: string }>(
      "select session_id, spent_on::text from public.expenses where id = $1",
      [spent.result.expenseId],
    );
    expect(expense.rows[0]).toEqual({ session_id: sessionId, spent_on: "2026-10-13" });

    expect(
      await failureOf(
        registerCollectorExpense(deps, w.collector, {
          idempotencyKey: key(),
          amount: 70_001,
          category: "GASOLINA",
        }),
      ),
    ).toMatchObject({ code: "INSUFFICIENT_FUNDS", status: 409 });
    expect(await sessionBalance(sessionId)).toBe(70_000);
  });
});

describe("intentos de cobro", () => {
  it("registra un intento fallido y un volver a cobrar sin alterar la deuda ni las cajas", async () => {
    const w = await world();
    const before = (await getLoanDetail(pool, w.admin, w.loanId, now()))!.pendingBalance;

    const failed = await registerAttempt(deps, w.collector, {
      idempotencyKey: key(),
      clientId: w.clientId,
      type: "INTENTO_FALLIDO",
      reason: "CLIENTE_AUSENTE",
    });
    const retry = await registerAttempt(deps, w.collector, {
      idempotencyKey: key(),
      clientId: w.clientId,
      type: "VOLVER_A_COBRAR",
      retryAt: "2099-01-01T15:00:00Z",
    });

    expect(failed.result.type).toBe("INTENTO_FALLIDO");
    expect(retry.result.type).toBe("VOLVER_A_COBRAR");
    expect((await getLoanDetail(pool, w.admin, w.loanId, now()))!.pendingBalance).toBe(before);
    const rows = await pool.query(
      "select type, reason from public.collection_attempts where client_id = $1 order by type",
      [w.clientId],
    );
    expect(rows.rows).toEqual([
      { type: "INTENTO_FALLIDO", reason: "CLIENTE_AUSENTE" },
      { type: "VOLVER_A_COBRAR", reason: null },
    ]);
  });

  it("solo clientes de su cartera, no el Admin, y las reglas del motivo las impone la base", async () => {
    const w = await world();
    const other = await world();

    expect(
      await failureOf(
        registerAttempt(deps, w.collector, {
          idempotencyKey: key(),
          clientId: other.clientId,
          type: "INTENTO_FALLIDO",
          reason: "SIN_DINERO",
        }),
      ),
    ).toMatchObject({ code: "CLIENT_NOT_FOUND", status: 404 });
    expect(
      await failureOf(
        registerAttempt(deps, w.admin, {
          idempotencyKey: key(),
          clientId: w.clientId,
          type: "INTENTO_FALLIDO",
          reason: "SIN_DINERO",
        }),
      ),
    ).toMatchObject({ status: 403 });

    // La base exige el motivo del fallido y la observación de OTRO aunque se salte la validación.
    for (const [type, reason, note] of [
      ["INTENTO_FALLIDO", null, null],
      ["INTENTO_FALLIDO", "OTRO", null],
      ["VOLVER_A_COBRAR", "SIN_DINERO", null],
    ] as const) {
      await expect(
        pool.query(
          "insert into public.collection_attempts (business_id, client_id, collector_id, type, reason, note, created_by) values ($1, $2, $3, $4, $5, $6, $7)",
          [w.businessId, w.clientId, w.collectorId, type, reason, note, w.collector.userId],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    }

    // Reasignado el cliente, su cobrador anterior ya no registra intentos.
    await assignAway(w);
    expect(
      await failureOf(
        registerAttempt(deps, w.collector, {
          idempotencyKey: key(),
          clientId: w.clientId,
          type: "INTENTO_FALLIDO",
          reason: "SIN_DINERO",
        }),
      ),
    ).toMatchObject({ code: "CLIENT_NOT_FOUND" });
  });
});
