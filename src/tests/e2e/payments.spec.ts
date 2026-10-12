import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { registerCapitalIncome } from "@/modules/cash/commands";
import { loadSessionContext } from "@/modules/identity/session";
import { createClient } from "@/modules/portfolio/clients";
import { confirmContract } from "@/modules/portfolio/contracts";
import { addDays, isoDate, localDateIn } from "@/shared/dates/dates";
import type { IdempotencyKey } from "@/shared/ids/idempotency-key";
import { TestFixtures, createAdminClient } from "../integration/helpers/auth";
import { createTestPool } from "../integration/helpers/db";

// Recorrido de pagos, mora, reverso y refinanciación con sesión real (F4). Se omite sin Supabase local.
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

/** Préstamo de $300.000 sin interés en 3 cuotas diarias de $100.000, con $2.000.000 en la Caja Mayor. */
async function seedLoan() {
  const businessId = await fixtures.business("Negocio pagos E2E");
  const account = await fixtures.account({ role: "ADMIN_NEGOCIO", businessId });
  const admin = await loadSessionContext(account.userId, pool);
  const deps = { db: pool };
  await registerCapitalIncome(deps, admin, { idempotencyKey: key(), amount: 2_000_000 });
  const client = await createClient(deps, admin, {
    name: "Pagador E2E",
    identification: randomUUID().slice(0, 8),
  });
  const today = localDateIn(new Date(), "America/Bogota");
  const loan = await confirmContract(deps, admin, {
    clientId: client.id,
    principal: 300_000,
    interestBps: 0,
    frequency: "DIARIA",
    installmentCount: 3,
    firstDueOn: isoDate(addDays(today, 1)),
    idempotencyKey: key(),
  });
  return { account, loanId: loan.result.loanId };
}

test("el Admin cobra con aplicación explicada, maneja la mora, reversa y refinancia", async ({
  page,
}) => {
  const { account, loanId } = await seedLoan();
  await login(page, account.username, account.password);
  await page.goto(`/negocio/prestamos/${loanId}`);

  const payForm = page.getByRole("form", { name: "Registrar pago" });
  const amount = payForm.getByLabel(/^Monto \(pesos\)/);

  // Un pago parcial se explica antes de enviarlo: cubre la cuota 1 y deja el faltante en la 2.
  await amount.fill("150000");
  await expect(page.getByTestId("explicacion-pago")).toContainText("Cuota 1");
  await expect(page.getByTestId("explicacion-pago")).toContainText("queda saldada");
  await expect(page.getByTestId("explicacion-pago")).toContainText("le quedan $50.000");

  // Más que el saldo pendiente se rechaza antes de llegar al servidor (no hay saldo a favor).
  await amount.fill("300001");
  await payForm.getByRole("button", { name: "Registrar pago" }).click();
  await expect(payForm).toContainText("supera el saldo pendiente");
  await expect(page.getByTestId("pago")).toHaveCount(0);

  await amount.fill("150000");
  await payForm.getByRole("button", { name: "Registrar pago" }).click();
  await expect(page.getByText(/Pago de \$150\.000 registrado/)).toBeVisible();
  await expect(page.getByTestId("pago")).toHaveCount(1);
  await expect(
    page.getByText("Saldo pendiente").locator("xpath=following-sibling::dd[1]"),
  ).toHaveText("$150.000");
  await expect(page.getByText("Pago parcial")).toBeVisible();

  // La mora es manual: se agrega con motivo y bloquea la refinanciación hasta pagarla o anularla.
  const feeForm = page.getByRole("form", { name: "Agregar cargo de mora" });
  await feeForm.getByRole("button", { name: "Agregar cargo" }).click();
  await expect(feeForm).toContainText("Escribe el motivo del cargo.");
  await feeForm.getByLabel(/^Monto \(pesos\)/).fill("10000");
  await feeForm.getByLabel(/^Motivo/).fill("Atraso de tres días");
  await feeForm.getByRole("button", { name: "Agregar cargo" }).click();
  await expect(page.getByTestId("cargo-mora")).toHaveCount(1);
  await expect(page.getByText(/Para refinanciar, primero paga o anula/)).toBeVisible();

  await page.getByRole("button", { name: "Anular cargo" }).click();
  await page.getByRole("button", { name: "Confirmar anulación del cargo" }).click();
  await expect(page.getByText("Escribe el motivo de la anulación.")).toBeVisible();
  await page.getByLabel("Motivo de la anulación").fill("Se cobró por error");
  await page.getByRole("button", { name: "Confirmar anulación del cargo" }).click();
  await expect(page.getByText(/Cargo de mora «Atraso de tres días» anulado/)).toBeVisible();
  await expect(page.getByTestId("cargo-mora")).toContainText("Anulado");

  // Reverso: solo el último pago, con motivo; el pago queda en el historial como reversado.
  await page.getByRole("button", { name: "Reversar pago" }).click();
  await page.getByRole("button", { name: "Confirmar reverso" }).click();
  await expect(page.getByText("Escribe el motivo del reverso.")).toBeVisible();
  await page.getByLabel("Motivo del reverso").fill("Monto mal digitado");
  await page.getByRole("button", { name: "Confirmar reverso" }).click();
  await expect(page.getByText(/Pago de \$150\.000 reversado/)).toBeVisible();
  await expect(page.getByTestId("pago")).toContainText("Reversado");
  await expect(page.getByRole("button", { name: "Reversar pago" })).toHaveCount(0);
  await expect(
    page.getByText("Saldo pendiente").locator("xpath=following-sibling::dd[1]"),
  ).toHaveText("$300.000");

  // Refinanciar: vista previa con el saldo pendiente y un adicional; no se guarda nada hasta confirmar.
  await amount.fill("150000");
  await payForm.getByRole("button", { name: "Registrar pago" }).click();
  await expect(page.getByTestId("pago")).toHaveCount(2);
  await page.getByRole("button", { name: "Refinanciar" }).click();
  const refinance = page.getByRole("form", { name: /^Refinanciar el contrato/ });
  await refinance.getByLabel(/^Monto adicional/).fill("50000");
  await refinance.getByLabel(/^Interés/).fill("10");
  await refinance.getByRole("button", { name: "Calcular" }).click();
  await expect(page.getByText("Vista previa de la refinanciación")).toBeVisible();
  await expect(
    page.getByText("Principal nuevo").locator("xpath=following-sibling::dd[1]"),
  ).toHaveText("$200.000");
  await page.getByRole("button", { name: "Refinanciar", exact: true }).last().click();

  // El préstamo nuevo reemplaza la deuda; el anterior queda refinanciado y enlazado.
  await expect(page).toHaveURL(/\/negocio\/prestamos\/(?!.*refinanciar)/);
  await expect(page.getByRole("heading", { level: 1, name: /Contrato CT-000002/ })).toBeVisible();
  await expect(page.getByText("Refinanciación del")).toBeVisible();
  await page.getByRole("link", { name: "préstamo anterior" }).click();
  await expect(page.getByText("Refinanciado").first()).toBeVisible();
  await expect(page.getByText("Su saldo pasó al")).toBeVisible();
  await expect(page.getByRole("button", { name: "Registrar pago" })).toHaveCount(0);

  // Mobile-first: sin desbordes horizontales.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
