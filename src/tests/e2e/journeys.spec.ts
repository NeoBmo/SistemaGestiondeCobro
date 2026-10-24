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
  for (const forbidden of ["/super-admin", "/negocio", "/negocio/caja"]) {
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
  // Restablecer no lleva clave de idempotencia: un doble clic debe enviar una sola petición.
  let resets = 0;
  await page.route("**/admin-password", async (route) => {
    resets += 1;
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.continue();
  });
  await page.getByRole("button", { name: "Restablecer contraseña" }).click();
  await page.getByRole("button", { name: "Sí, restablecer contraseña" }).dblclick();
  await expect(page.getByTestId("temporary-password")).toBeVisible();
  expect(resets).toBe(1);
  await page.unroute("**/admin-password");
  await page.reload();
  await expect(page.getByTestId("temporary-password")).toHaveCount(0);
});

test("tras 5 contraseñas incorrectas el login pide esperar, aun con la contraseña correcta", async ({
  page,
}) => {
  const businessId = await fixtures.business("Negocio bloqueo E2E");
  const account = await fixtures.account({ role: "ADMIN_NEGOCIO", businessId });

  for (let i = 0; i < 5; i += 1) {
    await login(page, account.username, "Incorrecta123");
    await expect(page.locator("main").getByRole("alert")).toContainText(
      "Usuario o contraseña incorrectos",
    );
  }
  await login(page, account.username, account.password);
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "Demasiados intentos fallidos. Espera 15 minutos",
  );
  await expect(page).toHaveURL(/\/login$/);
});

test("el Admin lleva la Caja Mayor: apertura, ingreso, gasto, reverso y saldo derivado", async ({
  page,
}) => {
  const businessId = await fixtures.business("Negocio caja E2E");
  const admin = await fixtures.account({ role: "ADMIN_NEGOCIO", businessId });

  await login(page, admin.username, admin.password);
  await expect(page).toHaveURL(/\/negocio$/);
  await page.getByRole("link", { name: "Registrar saldo de apertura" }).click();
  await expect(page).toHaveURL(/\/negocio\/caja$/);
  await expect(page.getByTestId("saldo")).toHaveText("$0");
  await expect(page.getByText("Aún no hay movimientos.")).toBeVisible();

  const form = (name: string) => page.getByRole("form", { name });
  const saldo = page.getByTestId("saldo");

  // Validación en el cliente: un monto inválido no envía nada y explica el motivo.
  await form("Saldo de apertura")
    .getByLabel(/^Monto/)
    .fill("12,5");
  await form("Saldo de apertura")
    .getByRole("button", { name: "Registrar saldo de apertura" })
    .click();
  await expect(form("Saldo de apertura").getByText(/pesos enteros/)).toBeVisible();

  await form("Saldo de apertura")
    .getByLabel(/^Monto/)
    .fill("500.000");
  await form("Saldo de apertura")
    .getByRole("button", { name: "Registrar saldo de apertura" })
    .click();
  await expect(
    page.getByText(/Saldo de apertura registrado\. Saldo de Caja Mayor: \$500\.000/),
  ).toBeVisible();
  await expect(saldo).toHaveText("$500.000");
  // La apertura es única: su formulario desaparece.
  await expect(form("Saldo de apertura")).toHaveCount(0);

  await form("Ingreso de capital")
    .getByLabel(/^Monto/)
    .fill("100000");
  await form("Ingreso de capital").getByRole("button", { name: "Registrar ingreso" }).click();
  await expect(saldo).toHaveText("$600.000");

  await form("Gasto de Caja Mayor").getByLabel("Categoría").selectOption("GASOLINA");
  await form("Gasto de Caja Mayor")
    .getByLabel(/^Monto/)
    .fill("40000");
  await form("Gasto de Caja Mayor").getByRole("button", { name: "Registrar gasto" }).click();
  await expect(saldo).toHaveText("$560.000");

  // Un gasto que supera el saldo se rechaza con un mensaje claro y el saldo no cambia.
  await form("Gasto de Caja Mayor")
    .getByLabel(/^Monto/)
    .fill("9000000");
  await form("Gasto de Caja Mayor").getByRole("button", { name: "Registrar gasto" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("no tiene saldo suficiente");
  await expect(saldo).toHaveText("$560.000");

  // Reverso del gasto: pide motivo, devuelve el dinero y el historial conserva ambos movimientos.
  const gasto = page.getByTestId("movimiento").filter({ hasText: "Gasto de Caja Mayor" }).first();
  await gasto.getByRole("button", { name: /^Reversar/ }).click();
  await page.getByRole("button", { name: "Confirmar reverso" }).click();
  await expect(page.getByText("Escribe el motivo del reverso.")).toBeVisible();
  await page.getByLabel("Motivo del reverso").fill("Gasto duplicado");
  await page.getByRole("button", { name: "Confirmar reverso" }).click();
  await expect(saldo).toHaveText("$600.000");
  // El resultado verificable sobrevive a la actualización del historial (el botón se desmonta).
  await expect(
    page.getByText(/Movimiento reversado\. Saldo de Caja Mayor: \$600\.000/),
  ).toBeVisible();
  await expect(page.getByText("⟲ Reversado")).toBeVisible();
  // Lo ya reversado y los reversos no ofrecen reversar otra vez: solo quedan apertura e ingreso.
  await expect(page.getByRole("button", { name: /^Reversar/ })).toHaveCount(2);
  await expect(page.getByTestId("movimiento")).toHaveCount(4);

  // Mobile-first: sin desbordes horizontales con el historial y todos los formularios.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
