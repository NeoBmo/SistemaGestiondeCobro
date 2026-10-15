import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { registerCapitalIncome, registerMainCashboxExpense } from "@/modules/cash/commands";
import { assignClient } from "@/modules/collections/assignments";
import { createCollector } from "@/modules/collections/collectors";
import { createRoute } from "@/modules/collections/routes";
import { openSession, transferFund } from "@/modules/collections/sessions";
import { confirmSettlement, declareSettlement } from "@/modules/collections/settlements";
import { getDashboard } from "@/modules/dashboard/queries";
import { saveDashboardConfig } from "@/modules/dashboard/settings";
import { loadSessionContext, type SessionContext } from "@/modules/identity/session";
import { createClient } from "@/modules/portfolio/clients";
import { confirmContract } from "@/modules/portfolio/contracts";
import { registerPayment, reversePayment } from "@/modules/portfolio/payments";
import { addDays, isoDate, localDateIn } from "@/shared/dates/dates";
import { AppError } from "@/shared/errors/app-error";
import type { IdempotencyKey } from "@/shared/ids/idempotency-key";
import { TEST_EMAIL_DOMAIN, TestFixtures, createAdminClient } from "./helpers/auth";
import { createTestPool } from "./helpers/db";

// F6 (02 §7, ADR 0010): el dashboard son agregados derivados de los hechos; nunca escribe balances.

const pool = createTestPool();
const admin = createAdminClient();
const fixtures = new TestFixtures(pool, admin);
const deps = { db: pool };
const key = () => randomUUID() as IdempotencyKey;
const unique = () => randomUUID().slice(0, 8);

afterAll(async () => {
  await fixtures.purge();
  await pool.end();
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

/** Hoy en la zona del negocio de las pruebas (Bogotá). */
const today = () => localDateIn(new Date(), "America/Bogota");

async function business(plan: "SEMANAL" | "MENSUAL" | "ANUAL" = "MENSUAL") {
  const businessId = await fixtures.business("Dashboard");
  if (plan !== "MENSUAL") {
    await pool.query("update public.subscriptions set plan_code = $2 where business_id = $1", [
      businessId,
      plan,
    ]);
  }
  const account = await fixtures.account({ role: "ADMIN_NEGOCIO", businessId });
  const actor: SessionContext = await loadSessionContext(account.userId, pool);
  await registerCapitalIncome(deps, actor, { idempotencyKey: key(), amount: 2_000_000 });
  return { businessId, actor };
}

/** Préstamo cuyas cuotas vencen en `firstOffset`, +1, +2… días desde hoy (negativo = ya vencidas). */
async function loan(
  w: { actor: SessionContext },
  options: { principal: number; installments: number; firstOffset: number; name?: string },
) {
  const client = await createClient(deps, w.actor, {
    name: options.name ?? "Cliente",
    identification: unique(),
  });
  // Desembolso 10 días atrás para que el vencimiento pasado sea coherente con la fecha del contrato.
  const disbursedAt = new Date(Date.now() - 10 * 86_400_000);
  const created = await confirmContract(
    deps,
    w.actor,
    {
      clientId: client.id,
      principal: options.principal,
      interestBps: 0,
      frequency: "DIARIA",
      installmentCount: options.installments,
      firstDueOn: isoDate(addDays(today(), options.firstOffset)),
      idempotencyKey: key(),
    },
    () => disbursedAt,
  );
  return { clientId: client.id, loanId: created.result.loanId };
}

describe("agregados de cartera y caja", () => {
  it("calcula cartera pendiente y vencida, clientes en mora, cobrado, gastos y proyección con cifras conocidas", async () => {
    const w = await business();
    const late = await loan(w, { principal: 300_000, installments: 3, firstOffset: -4 }); // vencen -4, -3, -2
    await loan(w, { principal: 200_000, installments: 2, firstOffset: 1, name: "Al día" }); // +1 y +2
    await registerPayment(deps, w.actor, {
      idempotencyKey: key(),
      loanId: late.loanId,
      amount: 150_000,
    });
    await registerMainCashboxExpense(deps, w.actor, {
      idempotencyKey: key(),
      amount: 20_000,
      category: "GASOLINA",
    });

    const data = await getDashboard(pool, w.actor);

    expect(data.cashBalance).toBe(2_000_000 - 300_000 - 200_000 + 150_000 - 20_000);
    expect(data.portfolio).toEqual({
      pending: 150_000 + 200_000,
      overdue: 150_000,
      clientsInArrears: 1,
      activeLoans: 2,
    });
    expect(data.collected).toBe(150_000);
    expect(data.spent).toBe(20_000);
    expect(data.projection).toHaveLength(7);
    expect(data.projection[0]).toEqual({ date: addDays(today(), 1), amount: 100_000 });
    expect(data.projection[1]).toEqual({ date: addDays(today(), 2), amount: 100_000 });
    expect(data.projection.slice(2).every((day) => day.amount === 0)).toBe(true);
    // Solo la mora de la cartera dispara la alerta de vencido.
    expect(data.alerts).toEqual([{ kind: "OVERDUE", clients: 1, amount: 150_000 }]);
  });

  it("el cobrado y el gasto son netos de reversos y un pago reversado vuelve a la cartera", async () => {
    const w = await business();
    const l = await loan(w, { principal: 300_000, installments: 3, firstOffset: -4 });
    const paid = await registerPayment(deps, w.actor, {
      idempotencyKey: key(),
      loanId: l.loanId,
      amount: 100_000,
    });
    expect((await getDashboard(pool, w.actor)).collected).toBe(100_000);

    await reversePayment(deps, w.actor, {
      idempotencyKey: key(),
      paymentId: paid.result.paymentId,
      reason: "Error",
    });

    const data = await getDashboard(pool, w.actor);
    expect(data.collected).toBe(0);
    expect(data.portfolio.pending).toBe(300_000);
    expect(data.portfolio.overdue).toBe(300_000);
  });

  it("no cuenta otros negocios, préstamos anulados ni lo pagado por completo", async () => {
    const w = await business();
    const other = await business();
    await loan(other, { principal: 900_000, installments: 3, firstOffset: -4 });
    const done = await loan(w, { principal: 100_000, installments: 1, firstOffset: 1 });
    await registerPayment(deps, w.actor, {
      idempotencyKey: key(),
      loanId: done.loanId,
      amount: 100_000,
    });

    const data = await getDashboard(pool, w.actor);

    expect(data.portfolio).toEqual({ pending: 0, overdue: 0, clientsInArrears: 0, activeLoans: 0 });
    expect(data.alerts).toEqual([]);
    expect(data.projection.every((day) => day.amount === 0)).toBe(true);
  });

  it("el periodo acota lo cobrado: un cobro de hoy cae en todos los periodos", async () => {
    const w = await business();
    const l = await loan(w, { principal: 300_000, installments: 3, firstOffset: 1 });
    await registerPayment(deps, w.actor, {
      idempotencyKey: key(),
      loanId: l.loanId,
      amount: 50_000,
    });
    await saveDashboardConfig(deps, w.actor, { period: "YEAR", widgets: ["COLLECTED"] });

    const data = await getDashboard(pool, w.actor);

    expect(data.config).toEqual({ period: "YEAR", widgets: ["COLLECTED"], configurable: true });
    expect(data.range.from).toBe(`${today().slice(0, 4)}-01-01`);
    expect(data.collected).toBe(50_000);
  });
});

describe("jornadas, diferencias y suscripción", () => {
  async function collectorWorld(w: Awaited<ReturnType<typeof business>>) {
    const created = await createCollector(
      { db: pool, admin, syntheticEmailDomain: TEST_EMAIL_DOMAIN },
      w.actor,
      { name: "Carlos", username: `cob.${unique()}` },
    );
    fixtures.track({ userId: created.userId });
    await pool.query("update public.profiles set status = 'ACTIVO' where id = $1", [
      created.userId,
    ]);
    const collector = await loadSessionContext(created.userId, pool);
    const route = await createRoute(deps, w.actor, {
      collectorId: created.collectorId,
      name: "Norte",
    });
    const client = await createClient(deps, w.actor, { name: "Ana", identification: unique() });
    await assignClient(deps, w.actor, { clientId: client.id, routeId: route.routeId });
    return collector;
  }

  it("alerta de jornada pendiente y de diferencia sin resolver, hasta que se confirma y resuelve", async () => {
    const w = await business();
    const collector = await collectorWorld(w);
    const sessionId = (await openSession(deps, collector, { idempotencyKey: key() })).result
      .sessionId;
    await transferFund(deps, w.actor, { idempotencyKey: key(), sessionId, amount: 100_000 });
    const declared = await declareSettlement(deps, collector, {
      idempotencyKey: key(),
      declaredAmount: 90_000,
    });

    let data = await getDashboard(pool, w.actor);
    expect(data.sessions.pending).toBe(1);
    expect(data.alerts).toContainEqual({ kind: "PENDING_SESSIONS", count: 1 });
    // La Caja Mayor no incluye el fondo que ya salió hacia la jornada ni lo que aún no entregó.
    expect(data.cashBalance).toBe(2_000_000 - 100_000);

    await confirmSettlement(deps, w.actor, {
      idempotencyKey: key(),
      settlementId: declared.result.settlementId,
      receivedAmount: 90_000,
      observation: "Faltaron 10.000",
    });
    data = await getDashboard(pool, w.actor);
    expect(data.sessions).toEqual({
      pending: 0,
      unresolvedDifferences: 1,
      unresolvedAmount: 10_000,
    });
    expect(data.alerts).toContainEqual({
      kind: "UNRESOLVED_DIFFERENCES",
      count: 1,
      amount: 10_000,
    });
    expect(data.cashBalance).toBe(2_000_000 - 100_000 + 90_000);
  });

  it("alerta de suscripción próxima a vencer o vencida, derivada de la fecha", async () => {
    const w = await business();
    expect((await getDashboard(pool, w.actor)).alerts).toEqual([]);

    await pool.query(
      "update public.subscriptions set starts_on = $2, expires_on = $3 where business_id = $1",
      [w.businessId, addDays(today(), -30), addDays(today(), 3)],
    );
    expect((await getDashboard(pool, w.actor)).alerts).toEqual([
      { kind: "SUBSCRIPTION", status: "PROXIMA_A_VENCER", expiresOn: addDays(today(), 3) },
    ]);

    await pool.query(
      "update public.subscriptions set starts_on = $2, expires_on = $3 where business_id = $1",
      [w.businessId, addDays(today(), -40), addDays(today(), -2)],
    );
    expect((await getDashboard(pool, w.actor)).alerts).toMatchObject([
      { kind: "SUBSCRIPTION", status: "VENCIDA" },
    ]);
  });

  it("solo el Admin lee el dashboard", async () => {
    const w = await business();
    const collector = await collectorWorld(w);
    await expect(getDashboard(pool, collector)).rejects.toMatchObject({ status: 403 });
  });
});

describe("configuración", () => {
  it("el plan semanal no la guarda (409 claro) y ve siempre el predeterminado; la base también lo impide", async () => {
    const w = await business("SEMANAL");

    expect(
      await failureOf(saveDashboardConfig(deps, w.actor, { period: "YEAR", widgets: ["SPENT"] })),
    ).toMatchObject({ code: "DASHBOARD_NOT_CONFIGURABLE", status: 403 });
    expect((await getDashboard(pool, w.actor)).config).toMatchObject({
      period: "7D",
      configurable: false,
    });

    await expect(
      pool.query(
        "insert into public.dashboard_settings (business_id, period, widgets, updated_by) values ($1, '30D', '[]'::jsonb, $2)",
        [w.businessId, w.actor.userId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("mensual y anual guardan indicadores, orden y periodo, con auditoría y sin tocar balances", async () => {
    const w = await business("ANUAL");
    const before = (await getDashboard(pool, w.actor)).cashBalance;

    const saved = await saveDashboardConfig(deps, w.actor, {
      period: "MONTH",
      widgets: ["PROJECTION", "CASH_BALANCE"],
    });

    expect(saved).toEqual({
      period: "MONTH",
      widgets: ["PROJECTION", "CASH_BALANCE"],
      configurable: true,
    });
    const again = await saveDashboardConfig(deps, w.actor, { period: "7D", widgets: [] });
    expect(again.widgets).toEqual([]);
    expect((await getDashboard(pool, w.actor)).cashBalance).toBe(before);
    const events = await pool.query<{ summary: { to: { period: string } } }>(
      "select summary from public.audit_events where business_id = $1 and action = 'DashboardConfigurado' order by occurred_at",
      [w.businessId],
    );
    expect(events.rows.map((r) => r.summary.to.period)).toEqual(["MONTH", "7D"]);
  });

  it("la base rechaza indicadores desconocidos o repetidos y no se borra ni se cambia de negocio", async () => {
    const w = await business();
    await saveDashboardConfig(deps, w.actor, { period: "30D", widgets: ["SPENT"] });
    const insert = (widgets: unknown) =>
      pool.query(
        "update public.dashboard_settings set widgets = $2::jsonb where business_id = $1",
        [w.businessId, JSON.stringify(widgets)],
      );

    await expect(insert(["NOPE"])).rejects.toMatchObject({ code: "23514" });
    await expect(insert(["SPENT", "SPENT"])).rejects.toMatchObject({ code: "23514" });
    await expect(
      pool.query("delete from public.dashboard_settings where business_id = $1", [w.businessId]),
    ).rejects.toMatchObject({ code: "23001" });
  });

  it("un cobrador no guarda la configuración", async () => {
    const w = await business();
    const account = await fixtures.account({ role: "COBRADOR", businessId: w.businessId });
    const collector = await loadSessionContext(account.userId, pool);
    expect(
      await failureOf(saveDashboardConfig(deps, collector, { period: "7D", widgets: [] })),
    ).toMatchObject({ status: 403 });
  });
});
