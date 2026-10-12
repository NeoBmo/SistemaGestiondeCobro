import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { TestFixtures, createAdminClient } from "../integration/helpers/auth";
import { createTestPool } from "../integration/helpers/db";

// Recorridos con sesión real contra el Supabase local (F1-T6). Se omiten si no está corriendo; en CI
// E2E_REQUIRE_SUPABASE=1 hace que su ausencia sea un error (ver playwright.config.ts).
test.skip(!process.env.E2E_REAL_SUPABASE, "Requiere Supabase local (npm run db:start)");

const pool = createTestPool();
const fixtures = new TestFixtures(pool, createAdminClient());

// Cada prueba limpia lo suyo; el pool no se cierra aquí porque un mismo worker encadena varias pruebas
// (se libera cuando Playwright termina el proceso).
test.afterEach(async () => {
  await fixtures.purge();
});

const NEW_PASSWORD = "NuevaClave2026";

async function login(page: Page, username: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Usuario").fill(username);
  await page.getByLabel(/^Contraseña/).fill(password);
  // Se espera la respuesta del login: navegar antes abortaría la petición y la sesión no se crearía.
  const response = page.waitForResponse((r) => r.url().endsWith("/api/auth/login"));
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await response;
}

async function logout(page: Page) {
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(page).toHaveURL(/\/login$/);
}

async function superAdminAccount() {
  return fixtures.account({ role: "SUPER_ADMIN", businessId: null });
}

test("el Super Admin crea un negocio y su administrador entra solo a su área", async ({ page }) => {
  const superAdmin = await superAdminAccount();
  const businessName = `Negocio E2E ${randomUUID().slice(0, 8)}`;
  const adminUsername = `e2e.${randomUUID().slice(0, 8)}`;

  await login(page, superAdmin.username, superAdmin.password);
  await expect(page).toHaveURL(/\/super-admin$/);

  // Alta: el resultado verificable es el negocio y la contraseña temporal, que se ve una sola vez.
  await page.getByRole("link", { name: "Nuevo negocio" }).click();
  await page.getByLabel(/^Nombre del negocio/).fill(businessName);
  await page.getByLabel(/^Nombre del responsable/).fill("Responsable E2E");
  await page.getByLabel(/^Identificación del responsable/).fill("123456");
  await page.getByLabel(/^Teléfono/).fill("3001234567");
  await page.getByLabel(/^Usuario del administrador/).fill(adminUsername);
  await page.getByRole("button", { name: "Crear negocio" }).click();
  await expect(page.getByText("Negocio creado")).toBeVisible();
  const temporaryPassword = (await page.getByTestId("temporary-password").textContent()) ?? "";
  expect(temporaryPassword.length).toBeGreaterThanOrEqual(8);

  await page.getByRole("link", { name: "Ver el negocio" }).click();
  await expect(page.getByRole("heading", { level: 1, name: businessName })).toBeVisible();
  const businessId = page.url().split("/").pop() ?? "";
  const { rows } = await pool.query<{ id: string }>(
    "select id from public.profiles where username = $1",
    [adminUsername],
  );
  fixtures.track({ businessId, userId: rows[0]?.id });
  await expect(page.getByText("Acceso activo", { exact: true })).toBeVisible();

  // Suspender: pide confirmación y bloquea el ingreso del administrador.
  await page.getByRole("button", { name: "Suspender negocio" }).click();
  await page.getByRole("button", { name: "Sí, suspender negocio" }).click();
  await expect(page.getByText("Acceso suspendido", { exact: true })).toBeVisible();
  await expect(page.getByText(/Negocio suspendido\. Acceso suspendido/)).toBeVisible();
  await logout(page);

  await login(page, adminUsername, temporaryPassword);
  await expect(page.locator("main").getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);

  // Activar restablece el acceso.
  await login(page, superAdmin.username, superAdmin.password);
  await page.goto(`/super-admin/negocios/${businessId}`);
  await page.getByRole("button", { name: "Activar negocio" }).click();
  await expect(page.getByText("Acceso activo", { exact: true })).toBeVisible();
  await logout(page);

  // Primer ingreso del administrador: cambio obligatorio de contraseña antes de entrar a su área.
  await login(page, adminUsername, temporaryPassword);
  await expect(page).toHaveURL(/\/cambiar-contrasena$/);
  await page.goto("/negocio");
  await expect(page).toHaveURL(/\/cambiar-contrasena$/);
  await page.getByLabel(/^Nueva contraseña/).fill(NEW_PASSWORD);
  await page.getByLabel(/^Repite la nueva contraseña/).fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Cambiar contraseña" }).click();
  await expect(page).toHaveURL(/\/negocio$/);

  // Aislamiento por rol: el administrador no entra a otras áreas y /login con sesión lo devuelve a la suya.
  for (const forbidden of ["/super-admin", "/super-admin/negocios/nuevo", "/cobrador"]) {
    await page.goto(forbidden);
    await expect(page).toHaveURL(/\/negocio$/);
  }
  await page.goto("/login");
  await expect(page).toHaveURL(/\/negocio$/);

  await logout(page);
  await page.goto("/negocio");
  await expect(page).toHaveURL(/\/login$/);
});

test("un cobrador solo ve su área y no puede cruzar a las de otros roles", async ({ page }) => {
  const businessId = await fixtures.business("Negocio cobrador E2E");
  const collector = await fixtures.account({ role: "COBRADOR", businessId });

  await login(page, collector.username, collector.password);
  await expect(page).toHaveURL(/\/cobrador$/);
  for (const forbidden of ["/super-admin", "/negocio"]) {
    await page.goto(forbidden);
    await expect(page).toHaveURL(/\/cobrador$/);
  }
});

test("un usuario bloqueado, o de un negocio suspendido, no entra y ve el motivo", async ({
  page,
}) => {
  const businessId = await fixtures.business("Negocio suspendido E2E");
  const admin = await fixtures.account({ role: "ADMIN_NEGOCIO", businessId });
  await fixtures.setBusinessAccess(businessId, "SUSPENDIDO");

  await login(page, admin.username, admin.password);
  await expect(page.locator("main").getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);

  await fixtures.setBusinessAccess(businessId, "ACTIVO");
  await fixtures.setProfileStatus(admin.userId, "BLOQUEADO");
  await login(page, admin.username, admin.password);
  await expect(page.locator("main").getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test("el Super Admin filtra la lista y la contraseña temporal restablecida no sobrevive a una recarga", async ({
  page,
}) => {
  const superAdmin = await superAdminAccount();
  const businessId = await fixtures.business("Negocio lista E2E");
  await fixtures.account({ role: "ADMIN_NEGOCIO", businessId });

  await login(page, superAdmin.username, superAdmin.password);
  await page.goto("/super-admin?q=lista%20e2e&estado=ACTIVA");
  await expect(page.getByRole("link", { name: /Negocio lista E2E/ })).toBeVisible();

  await page.goto("/super-admin?q=lista%20e2e&estado=ARCHIVADA");
  await expect(page.getByText("Ningún negocio coincide con los filtros.")).toBeVisible();

  await page.goto(`/super-admin/negocios/${businessId}`);
  await page.getByRole("button", { name: "Restablecer contraseña" }).click();
  await page.getByRole("button", { name: "Sí, restablecer contraseña" }).click();
  await expect(page.getByTestId("temporary-password")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("temporary-password")).toHaveCount(0);
});
