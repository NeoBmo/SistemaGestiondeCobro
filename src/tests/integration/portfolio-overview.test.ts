import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { registerCapitalIncome } from "@/modules/cash/commands";
import { assignClient } from "@/modules/collections/assignments";
import { createCollector } from "@/modules/collections/collectors";
import { createRoute } from "@/modules/collections/routes";
import {
  PAGE_SIZE,
  getClientBehavior,
  listPortfolio,
  parsePortfolioFilters,
} from "@/modules/dashboard/portfolio";
import { loadSessionContext, type SessionContext } from "@/modules/identity/session";
import { createClient } from "@/modules/portfolio/clients";
import { confirmContract } from "@/modules/portfolio/contracts";
import { getLoanDetail } from "@/modules/portfolio/loan-queries";
import { registerPayment } from "@/modules/portfolio/payments";
import { refinanceLoan } from "@/modules/portfolio/refinancing";
import { addDays, isoDate, localDateIn } from "@/shared/dates/dates";
import type { IdempotencyKey } from "@/shared/ids/idempotency-key";
import { TEST_EMAIL_DOMAIN, TestFixtures, createAdminClient } from "./helpers/auth";
import { createTestPool } from "./helpers/db";

// F6 (02 §7, ADR 0010): cartera con prioridad, filtros e historial de comportamiento, solo lectura.

const pool = createTestPool();
const admin = createAdminClient();
const fixtures = new TestFixtures(pool, admin);
const deps = { db: pool };
const key = () => randomUUID() as IdempotencyKey;
const unique = () => randomUUID().slice(0, 8);
const today = () => localDateIn(new Date(), "America/Bogota");

afterAll(async () => {
  await fixtures.purge();
  await pool.end();
});

async function business() {
  const businessId = await fixtures.business("Cartera");
  const account = await fixtures.account({ role: "ADMIN_NEGOCIO", businessId });
  const actor: SessionContext = await loadSessionContext(account.userId, pool);
  await registerCapitalIncome(deps, actor, { idempotencyKey: key(), amount: 5_000_000 });
  return { businessId, actor };
}

async function client(w: { actor: SessionContext }, name: string) {
  return createClient(deps, w.actor, { name, identification: unique() });
}

async function loan(
  w: { actor: SessionContext },
  clientId: string,
  options: { principal: number; installments: number; firstOffset: number },
) {
  const result = await confirmContract(
    deps,
    w.actor,
    {
      clientId,
      principal: options.principal,
      interestBps: 0,
      frequency: "DIARIA",
      installmentCount: options.installments,
      firstDueOn: isoDate(addDays(today(), options.firstOffset)),
      idempotencyKey: key(),
    },
    () => new Date(Date.now() - 10 * 86_400_000),
  );
  return result.result.loanId;
}

const filters = (params: Record<string, string> = {}) => parsePortfolioFilters(params);

describe("cartera", () => {
  it("ordena por prioridad (más mora, más saldo vencido, vencimiento más antiguo) y clasifica el estado", async () => {
    const w = await business();
    const calm = await client(w, "Beatriz Al Día");
    const worse = await client(w, "Zoila Muy Morosa");
    const mild = await client(w, "Marta Morosa");
    await client(w, "Sin Prestamo");
    await loan(w, calm.id, { principal: 100_000, installments: 2, firstOffset: 2 });
    await loan(w, worse.id, { principal: 300_000, installments: 3, firstOffset: -6 }); // 6, 5, 4 días
    await loan(w, mild.id, { principal: 300_000, installments: 3, firstOffset: -2 }); // 2, 1, 0 días

    const page = await listPortfolio(pool, w.actor, filters());

    expect(page.rows.map((r) => r.name)).toEqual([
      "Zoila Muy Morosa",
      "Marta Morosa",
      "Beatriz Al Día",
      "Sin Prestamo",
    ]);
    expect(page.rows.map((r) => r.status)).toEqual([
      "EN_MORA",
      "EN_MORA",
      "AL_DIA",
      "SIN_PRESTAMO",
    ]);
    expect(page.rows[0]).toMatchObject({
      maxDaysLate: 6,
      overdue: 300_000,
      totalPending: 300_000,
      activeLoans: 1,
    });
    expect(page.rows[1]).toMatchObject({ maxDaysLate: 2, overdue: 200_000 });
    expect(page.total).toBe(4);
  });

  it("la prioridad coincide con el detalle real de cuotas y mora del préstamo", async () => {
    const w = await business();
    const c = await client(w, "Detalle");
    const loanId = await loan(w, c.id, { principal: 300_000, installments: 3, firstOffset: -5 });
    await registerPayment(deps, w.actor, { idempotencyKey: key(), loanId, amount: 150_000 });

    const detail = await getLoanDetail(pool, w.actor, loanId);
    const row = (await listPortfolio(pool, w.actor, filters())).rows[0]!;

    expect(row.overdue).toBe(detail!.overdueBalance);
    expect(row.totalPending).toBe(detail!.pendingBalance);
    expect(row.maxDaysLate).toBe(Math.max(...detail!.installments.map((i) => i.daysLate)));
    expect(row.oldestDue).toBe(detail!.installments.find((i) => i.pendingAmount > 0)!.dueOn);
  });

  it("filtra por estado, texto, cobrador y ruta; el texto no interpreta comodines", async () => {
    const w = await business();
    const a = await client(w, "Ana Pérez");
    const b = await client(w, "Beto 100%");
    await loan(w, a.id, { principal: 100_000, installments: 2, firstOffset: -3 });
    await loan(w, b.id, { principal: 100_000, installments: 2, firstOffset: 2 });
    const created = await createCollector(
      { db: pool, admin, syntheticEmailDomain: TEST_EMAIL_DOMAIN },
      w.actor,
      { name: "Carlos", username: `cob.${unique()}` },
    );
    fixtures.track({ userId: created.userId });
    const route = await createRoute(deps, w.actor, {
      collectorId: created.collectorId,
      name: "Norte",
    });
    await assignClient(deps, w.actor, { clientId: a.id, routeId: route.routeId });

    const names = async (params: Record<string, string>) =>
      (await listPortfolio(pool, w.actor, filters(params))).rows.map((r) => r.name);

    expect(await names({ estado: "EN_MORA" })).toEqual(["Ana Pérez"]);
    expect(await names({ estado: "AL_DIA" })).toEqual(["Beto 100%"]);
    expect(await names({ q: "pérez" })).toEqual(["Ana Pérez"]);
    expect(await names({ q: "100%" })).toEqual(["Beto 100%"]);
    expect(await names({ q: "%" })).toEqual(["Beto 100%"]);
    expect(await names({ q: "_" })).toEqual([]);
    expect(await names({ cobrador: created.collectorId })).toEqual(["Ana Pérez"]);
    expect(await names({ ruta: route.routeId })).toEqual(["Ana Pérez"]);
    expect(
      (await listPortfolio(pool, w.actor, filters({ ruta: route.routeId }))).rows[0],
    ).toMatchObject({
      collectorName: "Carlos",
      routeName: "Norte",
    });
    // Un valor inválido se ignora en vez de romper la pantalla.
    expect(await names({ estado: "NOPE", cobrador: "x", pagina: "-3" })).toHaveLength(2);
  });

  it("pagina y no mezcla negocios", async () => {
    const w = await business();
    const other = await business();
    await client(other, "De otro negocio");
    for (let i = 0; i < PAGE_SIZE + 2; i++)
      await client(w, `Cliente ${String(i).padStart(2, "0")}`);

    const first = await listPortfolio(pool, w.actor, filters());
    const second = await listPortfolio(pool, w.actor, filters({ pagina: "2" }));

    expect(first.rows).toHaveLength(PAGE_SIZE);
    expect(second.rows).toHaveLength(2);
    expect(first.total).toBe(PAGE_SIZE + 2);
    expect(new Set([...first.rows, ...second.rows].map((r) => r.id)).size).toBe(PAGE_SIZE + 2);
    expect([...first.rows, ...second.rows].some((r) => r.name === "De otro negocio")).toBe(false);
  });

  it("un cobrador no lee la cartera del Admin", async () => {
    const w = await business();
    const account = await fixtures.account({ role: "COBRADOR", businessId: w.businessId });
    const collector = await loadSessionContext(account.userId, pool);
    await expect(listPortfolio(pool, collector, filters())).rejects.toMatchObject({ status: 403 });
  });
});

describe("historial de comportamiento", () => {
  it("cuenta cuotas a tiempo, tardías, la mora actual y las refinanciaciones, sin puntaje", async () => {
    const w = await business();
    const c = await client(w, "Historial");
    // Préstamo 1: cuotas vencidas hace 4, 3 y 2 días; se paga la 1.ª y la 2.ª hoy (tardías); la 3.ª sigue en mora.
    const first = await loan(w, c.id, { principal: 300_000, installments: 3, firstOffset: -4 });
    await registerPayment(deps, w.actor, { idempotencyKey: key(), loanId: first, amount: 200_000 });
    // Préstamo 2: vence mañana; se paga la 1.ª hoy, antes de vencer (a tiempo).
    const second = await loan(w, c.id, { principal: 200_000, installments: 2, firstOffset: 1 });
    await registerPayment(deps, w.actor, {
      idempotencyKey: key(),
      loanId: second,
      amount: 100_000,
    });

    const behavior = await getClientBehavior(pool, w.actor, c.id);
    expect(behavior).toEqual({
      paidOnTime: 1,
      paidLate: 2,
      overdueInstallments: 1,
      maxDaysLate: 2,
      overdue: 100_000,
      refinancings: 0,
    });
  });

  it("una refinanciación se cuenta y el préstamo anterior deja de ser deuda", async () => {
    const w = await business();
    const c = await client(w, "Refinanciado");
    const first = await loan(w, c.id, { principal: 300_000, installments: 3, firstOffset: -4 });
    await refinanceLoan(deps, w.actor, {
      idempotencyKey: key(),
      loanId: first,
      additionalAmount: 0,
      interestBps: 1000,
      frequency: "SEMANAL",
      installmentCount: 3,
      firstDueOn: isoDate(addDays(today(), 7)),
    });

    const behavior = await getClientBehavior(pool, w.actor, c.id);

    expect(behavior).toMatchObject({
      refinancings: 1,
      overdueInstallments: 0,
      overdue: 0,
      maxDaysLate: 0,
    });
    const page = await listPortfolio(pool, w.actor, filters());
    expect(page.rows[0]).toMatchObject({ status: "AL_DIA", overdue: 0, totalPending: 330_000 });
  });

  it("no mezcla clientes de otro negocio", async () => {
    const w = await business();
    const other = await business();
    const c = await client(other, "Ajeno");
    await loan(other, c.id, { principal: 100_000, installments: 1, firstOffset: -3 });

    expect(await getClientBehavior(pool, w.actor, c.id)).toMatchObject({
      paidOnTime: 0,
      paidLate: 0,
      overdueInstallments: 0,
    });
  });
});
