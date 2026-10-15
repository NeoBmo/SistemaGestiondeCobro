import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { registerCapitalIncome } from "@/modules/cash/commands";
import { assignClient } from "@/modules/collections/assignments";
import { createRoute } from "@/modules/collections/routes";
import { transferFund } from "@/modules/collections/sessions";
import { loadSessionContext } from "@/modules/identity/session";
import { createClient } from "@/modules/portfolio/clients";
import { confirmContract } from "@/modules/portfolio/contracts";
import { addDays, isoDate, localDateIn } from "@/shared/dates/dates";
import type { IdempotencyKey } from "@/shared/ids/idempotency-key";
import { TestFixtures, createAdminClient } from "../integration/helpers/auth";
import { createTestPool } from "../integration/helpers/db";

// Jornada del cobrador de principio a fin, en el viewport que toque (móvil por defecto en un proyecto).
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

/** Un cobrador con una ruta, dos clientes (uno con 4 cuotas vencidas, otro al día) y la jornada sin abrir. */
async function seed() {
  const businessId = await fixtures.business("Negocio cobrador E2E");
  const adminAccount = await fixtures.account({ role: "ADMIN_NEGOCIO", businessId });
  const admin = await loadSessionContext(adminAccount.userId, pool);
  const deps = { db: pool };
  await registerCapitalIncome(deps, admin, { idempotencyKey: key(), amount: 2_000_000 });

  const collectorAccount = await fixtures.account({ role: "COBRADOR", businessId });
  const collectorRow = await pool.query<{ id: string }>(
    "insert into public.collectors (business_id, user_id, name, created_by) values ($1, $2, 'Carlos', $3) returning id",
    [businessId, collectorAccount.userId, adminAccount.userId],
  );
  const route = await createRoute(deps, admin, {
    collectorId: collectorRow.rows[0]!.id,
    name: "Norte",
  });

  const today = localDateIn(new Date(), "America/Bogota");
  const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000);
  const mk = async (name: string, past: boolean) => {
    const client = await createClient(deps, admin, {
      name,
      identification: randomUUID().slice(0, 8),
      phone: "3001234567",
      whatsapp: "573001234567",
      address: "Calle 1 # 2-3",
    });
    await assignClient(deps, admin, { clientId: client.id, routeId: route.routeId });
    const loan = await confirmContract(
      deps,
      admin,
      {
        clientId: client.id,
        principal: 300_000,
        interestBps: 0,
        frequency: "DIARIA",
        installmentCount: 6,
        firstDueOn: past ? isoDate(addDays(today, -4)) : isoDate(addDays(today, 3)),
        idempotencyKey: key(),
      },
      past ? () => tenDaysAgo : undefined,
    );
    return { client, loanId: loan.result.loanId };
  };
  // Se crean en este orden a propósito: la prioridad debe poner primero al moroso.
  const current = await mk("Beatriz Al Día", false);
  const late = await mk("Zoila Morosa", true);
  return { adminAccount, admin, collectorAccount, current, late };
}

test("el cobrador abre su jornada, cobra, registra una visita y un gasto y entrega", async ({
  page,
}) => {
  const s = await seed();
  await login(page, s.collectorAccount.username, s.collectorAccount.password);
  await expect(page).toHaveURL(/\/cobrador$/);

  // Sin jornada: se ofrece abrirla y la lista ya está priorizada (más mora primero).
  await expect(page.getByRole("heading", { name: "Mi jornada" })).toBeVisible();
  const clients = page.getByTestId("cliente");
  await expect(clients).toHaveCount(2);
  await expect(clients.first()).toContainText("Zoila Morosa");
  await expect(clients.first()).toContainText("días de mora");
  // Meta: 4 cuotas vencidas + la de hoy (50.000 cada una).
  await expect(page.getByTestId("meta")).toHaveText("$250.000");

  await page.getByRole("button", { name: "Abrir mi jornada" }).click();
  await expect(page.getByText("Jornada abierta.")).toBeVisible();
  await expect(page.getByTestId("esperado")).toHaveText("$0");

  // El Admin le transfiere fondo.
  const sessionId = (
    await pool.query<{ id: string }>(
      "select s.id from public.cash_sessions s join public.collectors c on c.id = s.collector_id where c.user_id = $1",
      [s.collectorAccount.userId],
    )
  ).rows[0]!.id;
  await transferFund({ db: pool }, s.admin, { idempotencyKey: key(), sessionId, amount: 100_000 });
  await page.reload();
  await expect(page.getByTestId("esperado")).toHaveText("$100.000");

  // Cobro a la morosa: explica la aplicación y sube lo que debe tener en la mano.
  await clients.first().click();
  await expect(page.getByRole("link", { name: "Llamar" })).toHaveAttribute(
    "href",
    "tel:3001234567",
  );
  await expect(page.getByRole("link", { name: "WhatsApp" })).toHaveAttribute(
    "href",
    "https://wa.me/573001234567",
  );
  await expect(page.getByRole("link", { name: "Mapa" })).toHaveAttribute(
    "href",
    /google\.com\/maps/,
  );
  const payForm = page.getByRole("form", { name: "Registrar pago" });
  await payForm.getByLabel(/^Monto \(pesos\)/).fill("75000");
  await expect(page.getByTestId("explicacion-pago")).toContainText("Cuota 1");
  await payForm.getByRole("button", { name: "Registrar pago" }).click();
  await expect(page.getByText(/Pago de \$75\.000 registrado/)).toBeVisible();

  // Visita sin cobro al cliente al día: no cambia la deuda.
  await page.goto("/cobrador");
  await page.getByTestId("cliente").filter({ hasText: "Beatriz" }).click();
  await page.getByRole("button", { name: "No pude cobrar" }).click();
  await page.getByRole("button", { name: "Registrar intento fallido" }).click();
  await expect(page.getByText("Intento fallido registrado.")).toBeVisible();
  await expect(page.getByText(/No se pudo cobrar: El cliente no estaba/)).toBeVisible();

  // Gasto y entrega: debe tener 100.000 + 75.000 − 20.000 = 155.000 y declara menos.
  await page.goto("/cobrador");
  await page.getByRole("button", { name: "Registrar gasto" }).click();
  const expenseForm = page.getByRole("form", { name: "Registrar gasto" });
  await expenseForm.getByLabel(/^Monto \(pesos\)/).fill("20000");
  await expenseForm.getByRole("button", { name: "Registrar gasto" }).click();
  await expect(page.getByText(/Gasto registrado\. Debes tener \$155\.000/)).toBeVisible();
  await page.getByRole("button", { name: "Entregar y cerrar jornada" }).click();
  await page.getByLabel(/^Dinero que entregas/).fill("150000");
  await page.getByRole("button", { name: "Declarar entrega" }).click();
  await expect(page.getByText(/Entrega de \$150\.000 declarada/)).toBeVisible();
  await expect(page.getByText(/Espera a que el administrador confirme/)).toBeVisible();

  // Mobile-first: sin desbordes horizontales.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("un cobrador no ve los clientes de otro ni las pantallas del Admin", async ({ page }) => {
  const s = await seed();
  const other = await fixtures.account({
    role: "COBRADOR",
    businessId: (
      await pool.query<{ business_id: string }>(
        "select business_id from public.profiles where id = $1",
        [s.collectorAccount.userId],
      )
    ).rows[0]!.business_id,
  });
  // Un segundo cobrador del mismo negocio, sin ruta ni clientes.
  await pool.query(
    "insert into public.collectors (business_id, user_id, name, created_by) select business_id, id, 'Otro', $2 from public.profiles where id = $1",
    [other.userId, s.adminAccount.userId],
  );
  await login(page, other.username, other.password);
  await expect(page.getByText("Aún no tienes clientes asignados.")).toBeVisible();
  await page.goto(`/cobrador/clientes/${s.late.client.id}`);
  await expect(page.getByRole("heading", { name: "Cliente no encontrado" })).toBeVisible();
  await page.goto("/negocio/jornadas");
  await expect(page).toHaveURL(/\/cobrador$/);
});
