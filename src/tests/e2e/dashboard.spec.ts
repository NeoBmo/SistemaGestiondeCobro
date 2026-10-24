import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { registerCapitalIncome } from "@/modules/cash/commands";
import { loadSessionContext } from "@/modules/identity/session";
import { createClient } from "@/modules/portfolio/clients";
import { confirmContract } from "@/modules/portfolio/contracts";
import { registerPayment } from "@/modules/portfolio/payments";
import { addDays, isoDate, localDateIn } from "@/shared/dates/dates";
import type { IdempotencyKey } from "@/shared/ids/idempotency-key";
import { TestFixtures, createAdminClient } from "../integration/helpers/auth";
import { createTestPool } from "../integration/helpers/db";

// Dashboard, alertas, configuración por plan y cartera filtrable del Admin (F6). Se omite sin Supabase local.
test.skip(!process.env.E2E_REAL_SUPABASE, "Requiere Supabase local (npm run db:start)");

const pool = createTestPool();
const fixtures = new TestFixtures(pool, createAdminClient());
const key = () => randomUUID() as IdempotencyKey;

test.afterEach(async () => {
  await fixtures.purge();
});

async function login(page: Page, username: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Usuario").fill(username);
  await page.getByLabel(/^Contraseña/).fill(password);
  const response = page.waitForResponse((r) => r.url().endsWith("/api/auth/login"));
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await response;
}

async function seed(plan: "SEMANAL" | "MENSUAL") {
  const businessId = await fixtures.business("Negocio dashboard E2E");
  if (plan !== "MENSUAL") {
    await pool.query("update public.subscriptions set plan_code = $2 where business_id = $1", [
      businessId,
      plan,
    ]);
  }
  const account = await fixtures.account({ role: "ADMIN_NEGOCIO", businessId });
  const admin = await loadSessionContext(account.userId, pool);
  const deps = { db: pool };
  await registerCapitalIncome(deps, admin, { idempotencyKey: key(), amount: 2_000_000 });
  const today = localDateIn(new Date(), "America/Bogota");
  const mk = async (name: string, firstOffset: number) => {
    const client = await createClient(deps, admin, {
      name,
      identification: randomUUID().slice(0, 8),
    });
    const loan = await confirmContract(
      deps,
      admin,
      {
        clientId: client.id,
        principal: 300_000,
        interestBps: 0,
        frequency: "DIARIA",
        installmentCount: 3,
        firstDueOn: isoDate(addDays(today, firstOffset)),
        idempotencyKey: key(),
      },
      () => new Date(Date.now() - 10 * 86_400_000),
    );
    return { client, loanId: loan.result.loanId };
  };
  const late = await mk("Zoila Morosa", -4);
  await mk("Beatriz Al Día", 2);
  await registerPayment(deps, admin, {
    idempotencyKey: key(),
    loanId: late.loanId,
    amount: 100_000,
  });
  return { account };
}

test("el Admin ve el resumen con alertas derivadas y filtra la cartera por prioridad", async ({
  page,
}) => {
  const s = await seed("MENSUAL");
  await login(page, s.account.username, s.account.password);

  await expect(page.getByRole("heading", { name: "Resumen" })).toBeVisible();
  // Cartera pendiente: 200.000 (3.ª) + 100.000 (2.ª) de Zoila + 300.000 de Beatriz = 500.000; vencida 200.000.
  await expect(page.getByTestId("cartera-pendiente")).toHaveText("$500.000");
  await expect(page.getByTestId("cartera-vencida")).toHaveText("$200.000");
  // La cartera se rotula como solo cuotas; la mora pendiente es un indicador aparte (sin cargos: cero).
  await expect(page.getByTestId("widget-PORTFOLIO_PENDING")).toContainText("(cuotas)");
  await expect(page.getByTestId("mora-pendiente")).toHaveText("$0");
  await expect(page.getByTestId("cobrado")).toHaveText("$100.000");
  await expect(page.getByTestId("saldo-caja")).toHaveText("$1.500.000");
  await expect(page.getByTestId("alertas")).toContainText(
    "1 cliente tiene cuotas vencidas por $200.000",
  );

  // Cartera: la morosa primero y el filtro de estado.
  await page.getByRole("link", { name: /cuotas vencidas por/ }).click();
  await expect(page).toHaveURL(/estado=EN_MORA/);
  await expect(page.getByTestId("fila")).toHaveCount(1);
  await expect(page.getByTestId("fila")).toContainText("Zoila Morosa");
  await page.getByRole("link", { name: "Quitar filtros" }).click();
  await expect(page.getByTestId("fila")).toHaveCount(2);
  await expect(page.getByTestId("fila").first()).toContainText("Zoila Morosa");
  await page.getByLabel("Buscar").fill("beatriz");
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(page.getByTestId("fila")).toHaveCount(1);
  await expect(page.getByTestId("fila")).toContainText("Al día");
  await page.getByLabel("Buscar").fill("no-existe-zzz");
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(page.getByText("Ningún cliente coincide con los filtros.")).toBeVisible();

  // Historial en la ficha del cliente moroso.
  await page.goto("/negocio/cartera");
  await page.getByRole("link", { name: "Zoila Morosa" }).click();
  await expect(page.getByTestId("comportamiento")).toContainText("Cuotas pagadas tarde");
  await expect(page.getByTestId("comportamiento")).toContainText("Días de mora actual");
});

test("en un plan mensual el Admin configura indicadores, orden y periodo; el semanal no", async ({
  page,
}) => {
  const s = await seed("MENSUAL");
  await login(page, s.account.username, s.account.password);
  await expect(page.getByTestId("widget-CASH_BALANCE")).toBeVisible();

  await page.getByRole("button", { name: "Configurar dashboard" }).click();
  const form = page.getByRole("form", { name: "Configurar el dashboard" });
  await form.getByRole("checkbox", { name: "Caja Mayor" }).uncheck();
  await form.getByRole("combobox", { name: "Periodo" }).selectOption("YEAR");
  await form.getByRole("button", { name: "Bajar Cobrado del periodo" }).click();
  await form.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Dashboard actualizado.")).toBeVisible();
  await expect(page.getByTestId("widget-CASH_BALANCE")).toHaveCount(0);
  await expect(page.getByText(/Este año/)).toBeVisible();
  await expect(page.getByTestId("cartera-pendiente")).toHaveText("$500.000");
});

test("el plan semanal ve el predeterminado sin poder configurarlo", async ({ page }) => {
  const s = await seed("SEMANAL");
  await login(page, s.account.username, s.account.password);

  await expect(page.getByText(/Últimos 7 días/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Configurar dashboard" })).toHaveCount(0);
  await expect(page.getByText("Tu plan muestra el resumen predeterminado")).toBeVisible();

  // Mobile-first: sin desbordes horizontales.
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/negocio");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
