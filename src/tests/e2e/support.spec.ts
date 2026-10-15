import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { TestFixtures, createAdminClient } from "../integration/helpers/auth";
import { createTestPool } from "../integration/helpers/db";

// Soporte (tickets) y monitoreo desde el Super Admin y el Admin de negocio (F7). Se omite sin Supabase local.
test.skip(!process.env.E2E_REAL_SUPABASE, "Requiere Supabase local (npm run db:start)");

const pool = createTestPool();
const fixtures = new TestFixtures(pool, createAdminClient());

test.afterEach(async () => {
  await fixtures.purge();
});

async function nameOf(businessId: string): Promise<string> {
  const { rows } = await pool.query<{ name: string }>(
    "select name from public.businesses where id = $1",
    [businessId],
  );
  return rows[0]!.name;
}

async function login(page: Page, username: string, password: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Usuario").fill(username);
  await page.getByLabel(/^Contraseña/).fill(password);
  const response = page.waitForResponse((r) => r.url().endsWith("/api/auth/login"));
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await response;
}

test("el Admin abre un ticket, el Super Admin lo atiende y el Admin lo cierra con su historial", async ({
  page,
}) => {
  const businessId = await fixtures.business("Negocio soporte E2E");
  const admin = await fixtures.account({ role: "ADMIN_NEGOCIO", businessId });
  const root = await fixtures.account({ role: "SUPER_ADMIN", businessId: null });
  const businessName = await nameOf(businessId);

  await login(page, admin.username, admin.password);
  await page.goto("/negocio/soporte");
  await expect(page.getByText("Todavía no has abierto tickets.")).toBeVisible();
  await page.getByRole("button", { name: "Nuevo ticket" }).click();
  await page.getByRole("button", { name: "Enviar ticket" }).click();
  await expect(page.getByText("¿Qué necesitas?: es obligatorio.")).toBeVisible();
  await page.getByLabel(/^¿Qué necesitas\?/).fill("No puedo registrar un pago");
  await page.getByLabel("Prioridad").selectOption("ALTA");
  await page.getByRole("button", { name: "Enviar ticket" }).click();
  await expect(page.getByText(/Ticket enviado/)).toBeVisible();
  await expect(page.getByTestId("ticket")).toHaveCount(1);
  await expect(page.getByTestId("ticket")).toContainText("Prioridad alta");

  // El Super Admin lo ve con su negocio y lo atiende.
  await login(page, root.username, root.password);
  await page.goto("/super-admin/soporte");
  await expect(page.getByTestId("ticket").filter({ hasText: businessName })).toBeVisible();
  await page.getByRole("link", { name: businessName }).click();
  const attend = page.getByRole("form", { name: "Atender el ticket" });
  await attend.getByLabel("Estado").selectOption("RESUELTO");
  await attend.getByLabel("Respuesta").fill("Era un problema de conexión. Ya quedó.");
  await attend.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Ticket actualizado.")).toBeVisible();
  await expect(page.getByTestId("historial")).toContainText("Estado: Abierto → Resuelto");

  // El Admin ve la respuesta y el historial, y lo cierra.
  await login(page, admin.username, admin.password);
  await page.goto("/negocio/soporte");
  await page.getByRole("link", { name: /No puedo registrar un pago/ }).click();
  await expect(page.getByTestId("respuesta")).toContainText("Era un problema de conexión");
  await expect(page.getByTestId("historial")).toContainText(
    "Respuesta: Era un problema de conexión",
  );
  await page.getByRole("button", { name: "Cerrar ticket" }).first().click();
  await page.getByRole("button", { name: "Cerrar ticket" }).last().click();
  await expect(page.getByText("Ticket cerrado.")).toBeVisible();
  await expect(page.getByText("Cerrado").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Reabrir" })).toHaveCount(0);

  // Un Admin de otro negocio no ve ese ticket.
  const otherBusiness = await fixtures.business("Otro negocio soporte E2E");
  const other = await fixtures.account({ role: "ADMIN_NEGOCIO", businessId: otherBusiness });
  const ticketUrl = page.url();
  await login(page, other.username, other.password);
  await page.goto(ticketUrl);
  await expect(page.getByRole("heading", { name: "Ticket no encontrado" })).toBeVisible();
});

test("el Super Admin ve los indicadores, las alertas de suscripción sin suspensión y el tope de cobradores", async ({
  page,
}) => {
  const businessId = await fixtures.business("Negocio por vencer E2E");
  await pool.query(
    "update public.subscriptions set starts_on = current_date - 30, expires_on = current_date + 2 where business_id = $1",
    [businessId],
  );
  await pool.query("update public.subscriptions set plan_code = 'SEMANAL' where business_id = $1", [
    businessId,
  ]);
  const root = await fixtures.account({ role: "SUPER_ADMIN", businessId: null });
  const businessName = await nameOf(businessId);
  await login(page, root.username, root.password);

  // Panel de negocios: tope de cobradores del plan.
  await page.goto(`/super-admin?q=${encodeURIComponent(businessName)}`);
  await expect(page.getByTestId("cobradores")).toContainText("0 activos de 5");

  // Sin chequeos recientes: posible interrupción; con uno reciente, desaparece.
  await page.goto("/super-admin/monitoreo");
  await expect(page.getByRole("heading", { name: "Monitoreo" })).toBeVisible();
  await pool.query(
    "insert into public.health_checks (ok, database_ok, auth_ok, latency_ms) values (true, true, true, 25)",
  );
  await page.reload();
  await expect(page.getByTestId("interrupcion")).toHaveCount(0);
  await expect(page.getByTestId("disp-Últimas 24 horas")).not.toHaveText("—");

  // Suscripción por vencer: aviso sin suspender el acceso.
  await expect(page.getByRole("link", { name: businessName })).toBeVisible();
  const access = await pool.query("select access_status from public.businesses where id = $1", [
    businessId,
  ]);
  expect(access.rows[0]!.access_status).toBe("ACTIVO");

  // Backup: sin registros avisa; registrar una verificación lo actualiza.
  const today = new Date().toISOString().slice(0, 10);
  await page.getByRole("button", { name: "Registrar verificación" }).click();
  await page.getByLabel(/^Fecha/).fill(today);
  await page.getByLabel("Nota").fill(randomUUID().slice(0, 6));
  await page.getByRole("button", { name: "Registrar", exact: true }).click();
  await expect(page.getByText("Verificación registrada.")).toBeVisible();
  await expect(page.getByTestId("ultimo-backup")).toContainText("correcta");

  // Mobile-first: sin desbordes horizontales.
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/super-admin/monitoreo");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
