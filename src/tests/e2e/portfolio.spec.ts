import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { TestFixtures, createAdminClient } from "../integration/helpers/auth";
import { createTestPool } from "../integration/helpers/db";

// Recorridos de la cartera con sesión real (F3). Se omiten sin Supabase local (ver journeys.spec.ts).
test.skip(!process.env.E2E_REAL_SUPABASE, "Requiere Supabase local (npm run db:start)");

const pool = createTestPool();
const fixtures = new TestFixtures(pool, createAdminClient());

// Cada prueba limpia lo suyo; el pool no se cierra aquí porque un mismo worker encadena varias pruebas.
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

test("el Admin crea, busca y edita clientes; la identificación es única en su negocio", async ({
  page,
}) => {
  const businessId = await fixtures.business("Negocio clientes E2E");
  const admin = await fixtures.account({ role: "ADMIN_NEGOCIO", businessId });
  const idNumber = randomUUID().slice(0, 8);

  await login(page, admin.username, admin.password);
  await expect(page).toHaveURL(/\/negocio$/);
  await page.getByRole("link", { name: "Ver clientes" }).click();
  await expect(page.getByText("Aún no tienes clientes.")).toBeVisible();

  // Alta: lleva a la ficha del cliente creado.
  await page.getByRole("link", { name: "Nuevo cliente" }).click();
  await page.getByLabel(/^Nombre/).fill("Ana Pérez");
  await page.getByLabel(/^Identificación/).fill(idNumber);
  await page.getByLabel("Teléfono").fill("3001234567");
  await page.getByRole("button", { name: "Crear cliente" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Ana Pérez" })).toBeVisible();
  await expect(page.getByText("Este cliente aún no tiene préstamos.")).toBeVisible();

  // La identificación no se edita; el contacto sí.
  await expect(page.getByText("La identificación no se puede cambiar.")).toBeVisible();
  await page.getByLabel("Teléfono").fill("3109998888");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText("Contacto actualizado.")).toBeVisible();
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText("No había cambios que guardar.")).toBeVisible();

  // Misma identificación en el mismo negocio: error claro, nada se crea.
  await page.goto("/negocio/clientes/nuevo");
  await page.getByLabel(/^Nombre/).fill("Otra Ana");
  await page.getByLabel(/^Identificación/).fill(idNumber);
  await page.getByRole("button", { name: "Crear cliente" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("Ya existe un cliente");

  // Búsqueda por documento, y sin resultados.
  await page.goto("/negocio/clientes");
  await page.getByRole("searchbox").fill(idNumber);
  await page.getByRole("button", { name: "Buscar" }).click();
  await expect(page.getByRole("link", { name: "Ana Pérez" })).toBeVisible();
  await expect(page.getByText("1 cliente con esta búsqueda")).toBeVisible();
  await page.getByRole("searchbox").fill("no-existe-zzz");
  await page.getByRole("button", { name: "Buscar" }).click();
  await expect(page.getByText("Ningún cliente coincide con la búsqueda.")).toBeVisible();

  // Mobile-first: sin desbordes horizontales.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("un cobrador no entra a los clientes y un cliente de otro negocio da «no encontrado»", async ({
  page,
}) => {
  const businessId = await fixtures.business("Negocio cobrador clientes E2E");
  const collector = await fixtures.account({ role: "COBRADOR", businessId });
  await login(page, collector.username, collector.password);
  await expect(page).toHaveURL(/\/cobrador$/);
  for (const forbidden of ["/negocio/clientes", "/negocio/clientes/nuevo"]) {
    await page.goto(forbidden);
    await expect(page).toHaveURL(/\/cobrador$/);
  }

  const otherBusiness = await fixtures.business("Negocio admin clientes E2E");
  const admin = await fixtures.account({ role: "ADMIN_NEGOCIO", businessId: otherBusiness });
  await page.context().clearCookies();
  await login(page, admin.username, admin.password);
  await page.goto("/negocio/clientes/00000000-0000-4000-8000-000000000000");
  await expect(
    page.getByRole("heading", { level: 1, name: "Cliente no encontrado" }),
  ).toBeVisible();
});
