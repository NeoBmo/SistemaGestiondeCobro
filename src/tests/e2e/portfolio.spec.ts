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

test("el Admin calcula, confirma un préstamo y ve su calendario; la caja baja una sola vez", async ({
  page,
}) => {
  const businessId = await fixtures.business("Negocio préstamo E2E");
  const admin = await fixtures.account({ role: "ADMIN_NEGOCIO", businessId });
  await pool.query(
    `insert into public.cash_movements (business_id, cashbox_id, type, direction, amount, created_by)
     select $1, id, 'INGRESO_CAPITAL', 'ENTRADA', 2000000, $2 from public.main_cashboxes where business_id = $1`,
    [businessId, admin.userId],
  );
  const client = await pool.query<{ id: string }>(
    "insert into public.clients (business_id, name, identification, created_by) values ($1, 'Luis Prestatario', $2, $3) returning id",
    [businessId, randomUUID().slice(0, 8), admin.userId],
  );

  await login(page, admin.username, admin.password);
  await page.goto(`/negocio/clientes/${client.rows[0]!.id}`);
  await page.getByRole("link", { name: "Nuevo préstamo" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Nuevo préstamo" })).toBeVisible();

  // Validación en el cliente: un monto inválido no calcula nada.
  await page.getByLabel(/^Monto a prestar/).fill("12,5");
  await page.getByRole("button", { name: "Calcular" }).click();
  await expect(page.getByText(/pesos enteros/).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Vista previa" })).toHaveCount(0);

  // Vista previa del ejemplo del dominio: $1.000.000 al 20 % en 12 cuotas diarias de $100.000.
  await page.getByLabel(/^Monto a prestar/).fill("1000000");
  await page.getByRole("button", { name: "Calcular" }).click();
  await expect(page.getByRole("heading", { name: "Vista previa" })).toBeVisible();
  await expect(page.getByText("$1.200.000")).toBeVisible();
  await expect(page.getByText(/12 de/)).toContainText("$100.000");
  // Sin tasa de usura registrada la vista previa lo indica y no bloquea (02 §2.3).
  await expect(page.getByTestId("usura")).toContainText("Sin tasa de usura registrada");

  // Cambiar una condición descarta la vista previa: no se confirma algo que no se calculó.
  await page.getByLabel(/^Número de cuotas/).fill("6");
  await expect(page.getByRole("heading", { name: "Vista previa" })).toHaveCount(0);
  await page.getByLabel(/^Número de cuotas/).fill("12");
  await page.getByRole("button", { name: "Calcular" }).click();
  await page.getByRole("button", { name: "Confirmar préstamo y desembolsar" }).click();

  await expect(page.getByRole("heading", { level: 1, name: /Contrato CT-000001/ })).toBeVisible();
  await expect(
    page.getByText("Saldo pendiente").locator("xpath=following-sibling::dd[1]"),
  ).toHaveText("$1.200.000");
  await expect(page.getByTestId("cuota")).toHaveCount(12);

  // La Caja Mayor bajó exactamente el monto prestado, una sola vez.
  await page.goto("/negocio/caja");
  await expect(page.getByTestId("saldo")).toHaveText("$1.000.000");
  await expect(page.getByText("Desembolso de préstamo")).toBeVisible();

  // Anular exige motivo y confirmación, devuelve el desembolso y deja el préstamo sin deuda.
  await page.goBack();
  await page.getByRole("button", { name: "Anular contrato" }).click();
  await page.getByRole("button", { name: "Confirmar anulación" }).click();
  await expect(page.getByText("Escribe el motivo de la anulación.")).toBeVisible();
  await page.getByLabel("Motivo de la anulación").fill("El cliente se arrepintió");
  await page.getByRole("button", { name: "Confirmar anulación" }).click();
  await expect(page.getByText(/Contrato CT-000001 anulado. El desembolso volvió/)).toBeVisible();
  await expect(page.getByText(/Motivo: El cliente se arrepintió/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Anular contrato" })).toHaveCount(0);
  await expect(page.getByText("Anulada").first()).toBeVisible();
  await page.goto("/negocio/caja");
  await expect(page.getByTestId("saldo")).toHaveText("$2.000.000");

  // Mobile-first: sin desbordes en el detalle del préstamo.
  await page.goBack();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("el Admin importa un préstamo anterior: sin pagos ni cambios en la caja, con cuotas vencidas", async ({
  page,
}) => {
  const businessId = await fixtures.business("Negocio importación E2E");
  const admin = await fixtures.account({ role: "ADMIN_NEGOCIO", businessId });
  const client = await pool.query<{ id: string }>(
    "insert into public.clients (business_id, name, identification, created_by) values ($1, 'Rosa Antigua', $2, $3) returning id",
    [businessId, randomUUID().slice(0, 8), admin.userId],
  );

  await login(page, admin.username, admin.password);
  await page.goto(`/negocio/clientes/${client.rows[0]!.id}`);
  await page.getByRole("link", { name: "Importar préstamo anterior" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Importar préstamo anterior" }),
  ).toBeVisible();

  // Fechas relativas a hoy: el préstamo empezó hace 60 días y la próxima cuota venció hace 3.
  const day = (offset: number) => {
    // Hoy en la zona del negocio (Bogotá, UTC−5): se evita el cambio de día de UTC.
    const d = new Date(Date.now() - 5 * 3_600_000 + offset * 86_400_000);
    return d.toISOString().slice(0, 10);
  };
  await page.getByLabel("Fecha original del préstamo").fill(day(-60));
  await page.getByLabel(/^Monto prestado originalmente/).fill("1000000");
  await page.getByLabel("Frecuencia de cobro").selectOption("DIARIA");
  await page.getByLabel(/^Ya pagado antes de importar/).fill("500000");
  await page.getByLabel(/^Saldo pendiente hoy/).fill("700000");
  await page.getByLabel(/^Cuotas que faltan/).fill("7");
  await page.getByLabel("Próxima fecha de cobro").fill(day(-3));
  await page.getByRole("button", { name: "Calcular" }).click();

  await expect(page.getByRole("heading", { name: "Vista previa" })).toBeVisible();
  await expect(page.getByText("cuota(s) ya vencida(s)")).toBeVisible();
  await expect(page.getByText("Los datos históricos no cuadran")).toHaveCount(0);
  await page.getByRole("button", { name: "Importar préstamo" }).click();

  await expect(page.getByRole("heading", { level: 1, name: /Contrato CT-000001/ })).toBeVisible();
  await expect(page.getByText("Cartera importada")).toBeVisible();
  await expect(page.getByText("Pagado antes de importar")).toBeVisible();
  await expect(page.getByTestId("cuota")).toHaveCount(7);
  await expect(page.getByText("Vencida").first()).toBeVisible();

  // Importar no mueve la Caja Mayor.
  await page.goto("/negocio/caja");
  await expect(page.getByTestId("saldo")).toHaveText("$0");
  await expect(page.getByText("Aún no hay movimientos.")).toBeVisible();
});

test("el Super Admin registra la usura y un préstamo que la supera solo se confirma marcando la advertencia", async ({
  page,
}) => {
  // La usura es de plataforma: esta prueba borra su tasa al terminar para no alcanzar a las demás.
  const source = `Resolución E2E ${randomUUID().slice(0, 8)}`;
  try {
    const root = await fixtures.account({ role: "SUPER_ADMIN", businessId: null });
    await login(page, root.username, root.password);
    await page.goto("/super-admin/usura");
    await page.getByRole("button", { name: "Registrar tasa de usura" }).click();
    await page.getByLabel(/^Tasa efectiva anual/).fill("28,59");
    // Ayer en UTC: nunca es posterior a «hoy» en Bogotá (UTC−5), el día del desembolso.
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await page.getByLabel(/^Rige desde/).fill(yesterday);
    await page.getByLabel(/^Fuente/).fill(source);
    await page.getByRole("button", { name: "Registrar", exact: true }).click();
    await expect(page.getByText("Tasa de usura registrada.")).toBeVisible();
    await expect(page.getByTestId("usura-vigente")).toContainText("28,59 % E.A.");
    await expect(page.getByTestId("usura-vigente")).toContainText(source);

    const businessId = await fixtures.business("Negocio usura E2E");
    const admin = await fixtures.account({ role: "ADMIN_NEGOCIO", businessId });
    await pool.query(
      `insert into public.cash_movements (business_id, cashbox_id, type, direction, amount, created_by)
       select $1, id, 'INGRESO_CAPITAL', 'ENTRADA', 2000000, $2 from public.main_cashboxes where business_id = $1`,
      [businessId, admin.userId],
    );
    const client = await pool.query<{ id: string }>(
      "insert into public.clients (business_id, name, identification, created_by) values ($1, 'Eva Usura', $2, $3) returning id",
      [businessId, randomUUID().slice(0, 8), admin.userId],
    );
    await page.context().clearCookies();
    await login(page, admin.username, admin.password);
    await page.goto(`/negocio/prestamos/nuevo?cliente=${client.rows[0]!.id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Nuevo préstamo" })).toBeVisible();

    // 20 % en 12 cuotas diarias: miles de por ciento efectivo anual, muy por encima de la usura.
    await page.getByLabel(/^Monto a prestar/).fill("1000000");
    await page.getByRole("button", { name: "Calcular" }).click();
    const warning = page.getByTestId("usura");
    await expect(warning).toContainText("Este préstamo supera la tasa de usura");
    await expect(warning).toContainText("3.688.101,10 % E.A.");
    await expect(warning).toContainText("28,59 % E.A.");

    const confirm = page.getByRole("button", { name: "Confirmar préstamo y desembolsar" });
    await expect(confirm).toBeDisabled();
    await page.getByLabel(/Conozco la advertencia de usura/).check();
    await confirm.click();
    await expect(page.getByRole("heading", { level: 1, name: /Contrato CT-000001/ })).toBeVisible();

    const audit = await pool.query<{ summary: { usury: Record<string, unknown> } }>(
      `select e.summary from public.audit_events e
        where e.business_id = $1 and e.action = 'ContratoConfirmado'`,
      [businessId],
    );
    expect(audit.rows[0]?.summary.usury).toMatchObject({
      usuryRateBps: 2859,
      confirmedWithUsuryWarning: true,
    });
  } finally {
    const db = await pool.connect();
    try {
      await db.query("begin");
      // Solo agregado: los disparadores se desactivan únicamente en esta limpieza (como en `purge`).
      await db.query("set local session_replication_role = replica");
      await db.query("delete from public.usury_rates where source = $1", [source]);
      await db.query("commit");
    } finally {
      db.release();
    }
  }
});
