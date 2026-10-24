import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { registerCapitalIncome } from "@/modules/cash/commands";
import { openSession } from "@/modules/collections/sessions";
import { declareSettlement } from "@/modules/collections/settlements";
import { loadSessionContext } from "@/modules/identity/session";
import { createClient } from "@/modules/portfolio/clients";
import type { IdempotencyKey } from "@/shared/ids/idempotency-key";
import { TestFixtures, createAdminClient } from "../integration/helpers/auth";
import { createTestPool } from "../integration/helpers/db";

// Recorrido del Admin con cobradores, rutas, asignaciones, fondo y liquidación (F5). Se omite sin Supabase local.
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

test("el Admin crea un cobrador y su ruta, asigna un cliente, da fondo y confirma la liquidación", async ({
  page,
}) => {
  const businessId = await fixtures.business("Negocio cobranza E2E");
  const account = await fixtures.account({ role: "ADMIN_NEGOCIO", businessId });
  const admin = await loadSessionContext(account.userId, pool);
  await registerCapitalIncome({ db: pool }, admin, { idempotencyKey: key(), amount: 1_000_000 });
  const client = await createClient({ db: pool }, admin, {
    name: "Ana Cartera",
    identification: randomUUID().slice(0, 8),
  });

  await login(page, account.username, account.password);

  // Cobradores: estado vacío, alta con la contraseña temporal visible una sola vez.
  await page.goto("/negocio/cobradores");
  await expect(page.getByText("Aún no tienes cobradores.")).toBeVisible();
  await page.getByRole("button", { name: "Nuevo cobrador" }).click();
  await page.getByRole("button", { name: "Crear cobrador" }).click();
  await expect(page.getByText("Nombre: es obligatorio.")).toBeVisible();
  const username = `cob.${randomUUID().slice(0, 6)}`;
  await page.getByLabel(/^Nombre/).fill("Carlos Cobrador");
  await page.getByLabel(/^Usuario/).fill(username);
  await page.getByRole("button", { name: "Crear cobrador" }).click();
  await expect(page.getByText(/contraseña temporal: /)).toBeVisible();
  await expect(page.getByTestId("cobrador")).toHaveCount(1);
  await expect(page.getByText("Sin ruta activa")).toBeVisible();

  // Rutas: se crea para el cobrador y queda activa.
  await page.goto("/negocio/rutas");
  await page.getByRole("button", { name: "Nueva ruta" }).click();
  await page.getByLabel(/^Nombre de la ruta/).fill("Ruta Norte");
  await page.getByRole("button", { name: "Crear ruta" }).click();
  await expect(page.getByText("Ruta «Ruta Norte» creada.")).toBeVisible();
  await expect(page.getByTestId("ruta")).toContainText("Activa");

  // Asignación desde la ficha del cliente.
  await page.goto(`/negocio/clientes/${client.id}`);
  await expect(page.getByTestId("asignacion")).toContainText("no está asignado");
  await page.getByRole("button", { name: "Asignar", exact: true }).click();
  await expect(page.getByTestId("asignacion")).toContainText("Ruta Norte");

  // Jornada: la abre el cobrador (servicio) y el Admin le transfiere fondo.
  const collectorUser = (
    await pool.query<{ id: string }>("select id from public.profiles where username = $1", [
      username,
    ])
  ).rows[0]!.id;
  fixtures.track({ userId: collectorUser });
  await pool.query("update public.profiles set status = 'ACTIVO' where id = $1", [collectorUser]);
  const collector = await loadSessionContext(collectorUser, pool);
  await openSession({ db: pool }, collector, { idempotencyKey: key() });

  await page.goto("/negocio/jornadas");
  await expect(page.getByTestId("jornada")).toContainText("Abierta");
  await page.getByRole("button", { name: "Transferir fondo" }).click();
  await page.getByLabel(/^Monto/).fill("100000");
  await page.getByRole("button", { name: "Transferir", exact: true }).click();
  await expect(page.getByText(/Fondo de \$100\.000 transferido/)).toBeVisible();
  await expect(page.getByTestId("jornada")).toContainText("$100.000");

  // El cobrador declara menos de lo esperado; el Admin confirma con observación y queda la diferencia.
  await declareSettlement({ db: pool }, collector, {
    idempotencyKey: key(),
    declaredAmount: 90_000,
  });
  await page.goto("/negocio/jornadas");
  await expect(page.getByTestId("jornada")).toContainText("Pendiente de liquidar");
  await page.getByRole("button", { name: "Confirmar liquidación" }).click();
  await page.getByLabel(/^Dinero recibido/).fill("90000");
  await page.getByRole("button", { name: "Confirmar", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("observación");
  await page.getByLabel("Observación").fill("Faltaron 10.000");
  await page.getByRole("button", { name: "Confirmar", exact: true }).click();
  await expect(page.getByText(/Liquidación con faltante de \$10\.000/)).toBeVisible();
  await expect(page.getByTestId("jornada")).toContainText("Liquidada con diferencia");

  // Dos formas de resolver (02 §5.5): reposición (ajuste) o asumida por el negocio (sin dinero).
  await expect(page.getByRole("button", { name: "Asumir diferencia" })).toBeVisible();
  // La reposición entra el faltante a la Caja Mayor.
  await page.getByRole("button", { name: "Registrar reposición" }).click();
  await page.getByLabel(/^Motivo/).fill("El cobrador repuso el faltante");
  await page.getByRole("button", { name: "Registrar ajuste" }).click();
  await expect(page.getByText(/Diferencia resuelta con un ajuste de \$10\.000/)).toBeVisible();
  await expect(page.getByTestId("jornada")).toContainText("Resuelta por reposición");
  // Una sola vez: ya no se ofrece ninguna de las dos.
  await expect(page.getByRole("button", { name: "Asumir diferencia" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Registrar reposición" })).toHaveCount(0);
  await page.goto("/negocio/caja");
  await expect(page.getByTestId("saldo")).toHaveText("$1.000.000");

  // Mobile-first: sin desbordes horizontales.
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/negocio/jornadas");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("un cobrador no entra a las pantallas de cobranza del Admin", async ({ page }) => {
  const businessId = await fixtures.business("Negocio acceso cobranza E2E");
  const collector = await fixtures.account({ role: "COBRADOR", businessId });
  await login(page, collector.username, collector.password);
  await expect(page).toHaveURL(/\/cobrador$/);
  for (const forbidden of ["/negocio/cobradores", "/negocio/rutas", "/negocio/jornadas"]) {
    await page.goto(forbidden);
    await expect(page).toHaveURL(/\/cobrador$/);
  }
});
