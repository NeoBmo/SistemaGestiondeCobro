import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { TestFixtures, createAdminClient } from "../integration/helpers/auth";
import { createTestPool } from "../integration/helpers/db";
import type pg from "pg";

let pool: pg.Pool | undefined;
let fixtures: TestFixtures | undefined;

async function login(page: Page, username: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Usuario").fill(username);
  await page.getByLabel(/^Contraseña/).fill(password);
  const response = page.waitForResponse((r) => r.url().endsWith("/api/auth/login"));
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await response;
}

test.beforeAll(async () => {
  test.skip(!process.env.E2E_REAL_SUPABASE, "Requiere Supabase local (npm run db:start)");
  pool = createTestPool();
  fixtures = new TestFixtures(pool, createAdminClient());
});

test.afterAll(async () => {
  await fixtures?.purge();
  await pool?.end();
});

test("las áreas privadas de los tres perfiles son utilizables en los tres anchos", async ({
  page,
}, testInfo) => {
  test.skip(!process.env.E2E_REAL_SUPABASE, "Requiere Supabase local (npm run db:start)");
  const businessId = await fixtures!.business("Perfiles frontend E2E");
  const admin = await fixtures!.account({ role: "ADMIN_NEGOCIO", businessId });
  const collector = await fixtures!.account({ role: "COBRADOR", businessId });
  const superAdmin = await fixtures!.account({ role: "SUPER_ADMIN", businessId: null });
  await pool!.query(
    "insert into public.collectors (business_id, user_id, name, created_by) values ($1, $2, 'Cobrador E2E', $3)",
    [businessId, collector.userId, admin.userId],
  );

  const profiles = [
    {
      name: "super-admin",
      username: superAdmin.username,
      password: superAdmin.password,
      path: "/super-admin",
      heading: "Negocios",
    },
    {
      name: "administrador",
      username: admin.username,
      password: admin.password,
      path: "/negocio",
      heading: "Negocio",
    },
    {
      name: "cobrador",
      username: collector.username,
      password: collector.password,
      path: "/cobrador",
      heading: "Mi jornada",
    },
  ];

  for (const profile of profiles) {
    await page.context().clearCookies();
    await login(page, profile.username, profile.password);
    await page.goto(profile.path);
    await expect(page.getByRole("heading", { name: profile.heading })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex,\s*nofollow/,
    );

    for (const width of [360, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.reload();
      await expect(page.getByRole("heading", { name: profile.heading })).toBeVisible();
      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(overflows, `${profile.name} presenta overflow horizontal a ${width}px`).toBe(false);

      if (profile.name === "cobrador") {
        const primaryAction = page.getByRole("button", { name: "Abrir mi jornada" });
        const box = await primaryAction.boundingBox();
        expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      }

      await testInfo.attach(`${profile.name}-${width}`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
    }

    await page.setViewportSize({ width: 1280, height: 900 });
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      results.violations.map(({ id, impact, help }) => ({ id, impact, help })),
      `${profile.name} presenta hallazgos axe`,
    ).toEqual([]);
  }
});
