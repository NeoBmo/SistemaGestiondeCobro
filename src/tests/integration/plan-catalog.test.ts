import { afterAll, describe, expect, it } from "vitest";
import { PLAN_CATALOG } from "@/modules/subscriptions/plan-catalog";
import { money } from "@/shared/money/money";
import { createTestPool } from "./helpers/db";

// La landing es estática y no lee la BD: esta prueba evita que su catálogo se desvíe de `plans`.

const pool = createTestPool();
afterAll(() => pool.end());

describe("PLAN_CATALOG vs public.plans", () => {
  it("coincide en código, precio, límite de cobradores y dashboard configurable", async () => {
    const { rows } = await pool.query<{
      code: string;
      price_amount: string;
      max_active_collectors: number | null;
      dashboard_configurable: boolean;
    }>(
      `select code, price_amount::text, max_active_collectors, dashboard_configurable
         from public.plans order by code`,
    );

    const fromDb = rows.map((row) => ({
      code: row.code,
      priceAmount: money(row.price_amount),
      maxActiveCollectors: row.max_active_collectors,
      dashboardConfigurable: row.dashboard_configurable,
    }));
    const fromCatalog = PLAN_CATALOG.map(
      ({ code, priceAmount, maxActiveCollectors, dashboardConfigurable }) => ({
        code,
        priceAmount,
        maxActiveCollectors,
        dashboardConfigurable,
      }),
    ).sort((a, b) => a.code.localeCompare(b.code));

    expect(fromCatalog).toEqual(fromDb);
  });
});
