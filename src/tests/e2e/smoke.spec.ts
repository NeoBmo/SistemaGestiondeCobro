import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Humo sin Supabase real: el entorno de Playwright usa URLs ficticias. Sin cookies de sesión ninguna
// página hace llamadas de red, así que las redirecciones y las páginas públicas se pueden probar aquí.
// Los recorridos con sesión real (login, cambio de contraseña, panel) van en T1.6 con Supabase local.

const publicPages = [
  { path: "/", heading: "Cuadre" },
  { path: "/login", heading: "Iniciar sesión" },
];

const privatePages = [
  "/super-admin",
  "/super-admin/negocios/nuevo",
  "/super-admin/negocios/00000000-0000-0000-0000-000000000000",
  "/negocio",
  "/cobrador",
  "/cambiar-contrasena",
];

for (const { path, heading } of publicPages) {
  test(`${path} responde 200 con su título y un único landmark main`, async ({ page }) => {
    const response = await page.goto(path);

    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.getByRole("main")).toHaveCount(1);
  });
}

for (const path of privatePages) {
  test(`${path} sin sesión redirige al login`, async ({ page }) => {
    await page.goto(path);

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { level: 1, name: "Iniciar sesión" })).toBeVisible();
  });
}

test("la landing muestra los tres planes sin cifras de precio", async ({ page }) => {
  await page.goto("/");

  const plans = page.getByRole("region", { name: "Planes" });
  for (const name of ["Semanal", "Mensual", "Anual"]) {
    await expect(plans.getByRole("heading", { level: 3, name })).toBeVisible();
  }
  await expect(plans).not.toContainText(/\$\s?\d/);
  await expect(page.getByRole("link", { name: "Iniciar sesión" }).first()).toHaveAttribute(
    "href",
    "/login",
  );
});

test("el tema de la landing sigue la preferencia clara u oscura del dispositivo", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");

  await expect(page.locator("html")).toHaveCSS("color-scheme", "light");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(246, 251, 249)");
  await expect(page.locator("body")).toHaveCSS("color", "rgb(17, 30, 25)");
  await expect(page.locator("body")).toHaveCSS("font-family", /brandSans/);
  const brandFontLoaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].some(
      (font) => font.family.includes("brandSans") && font.status === "loaded",
    );
  });
  expect(brandFontLoaded).toBe(true);
  const brandLink = page.getByRole("link", { name: "Cuadre" });
  await expect(brandLink).toBeVisible();
  await expect(brandLink.locator('[aria-hidden="true"]')).toHaveCSS(
    "background-color",
    "rgb(0, 103, 79)",
  );
  await expect(page.locator('head link[rel="icon"]')).toHaveAttribute("href", /icon/);
  await expect(page.getByRole("link", { name: "Iniciar sesión" }).first()).toHaveCSS(
    "background-color",
    "rgb(0, 103, 79)",
  );

  await page.emulateMedia({ colorScheme: "dark" });

  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(10, 16, 14)");
  await expect(page.locator("body")).toHaveCSS("color", "rgb(232, 241, 237)");
  await expect(brandLink.locator('[aria-hidden="true"]')).toHaveCSS(
    "background-color",
    "rgb(63, 146, 120)",
  );
  await expect(page.getByRole("link", { name: "Iniciar sesión" }).first()).toHaveCSS(
    "background-color",
    "rgb(63, 146, 120)",
  );

  await page.goto("/login");
  await expect(page.getByLabel("Usuario")).toHaveCSS("background-color", "rgb(17, 24, 21)");
  await expect(page.getByLabel("Usuario")).toHaveCSS("border-top-color", "rgb(93, 102, 98)");
});

test("el formulario de login tiene etiquetas asociadas y se envía con el teclado", async ({
  page,
}) => {
  await page.goto("/login");

  await page.getByLabel("Usuario").fill("alguien");
  await page.getByLabel(/^Contraseña/).fill("Clave12345");
  await page.getByLabel(/^Contraseña/).press("Enter");

  // Sin Supabase real la respuesta es un error; lo importante es que se anuncia, no que desaparezca.
  await expect(page.locator("main").getByRole("alert")).toBeVisible();
  await expect(page.locator("main").getByRole("alert")).not.toContainText(
    /stack|\b50\d\b|undefined/i,
  );
});

test("«Mostrar contraseña» alterna el tipo del campo y expone su estado", async ({ page }) => {
  await page.goto("/login");
  const password = page.getByLabel(/^Contraseña/);
  const toggle = page.getByRole("button", { name: "Mostrar contraseña" });

  await expect(password).toHaveAttribute("type", "password");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(password).toHaveAttribute("type", "text");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
});

test("GET /api/health responde ok y sin caché", async ({ request }) => {
  const response = await request.get("/api/health");

  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect(await response.json()).toEqual({ status: "ok" });
});

test("«Saltar al contenido» es el primer foco del teclado y se hace visible", async ({ page }) => {
  await page.goto("/login");
  await page.keyboard.press("Tab");

  const skipLink = page.getByRole("link", { name: "Saltar al contenido" });
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeVisible();
});

test("las páginas públicas son utilizables a 360, 768 y 1280 px", async ({ page }, testInfo) => {
  for (const width of [360, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });

    for (const { path, heading } of publicPages) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();

      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(overflows, `${path} presenta overflow horizontal a ${width}px`).toBe(false);

      await testInfo.attach(`viewport-${width}-${path === "/" ? "landing" : "login"}`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
    }
  }
});

test("prefers-reduced-motion reduce las transiciones y conserva el foco visible", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");
  await page.keyboard.press("Tab");

  const skipLink = page.getByRole("link", { name: "Saltar al contenido" });
  await expect(skipLink).toBeFocused();

  const reducedTransition = await page
    .getByRole("button", { name: "Iniciar sesión" })
    .evaluate((element) => Number.parseFloat(getComputedStyle(element).transitionDuration));
  expect(reducedTransition).toBeLessThanOrEqual(0.001);
});

test("los botones y enlaces principales miden al menos 44×44 px", async ({ page }) => {
  await page.goto("/login");

  for (const target of [
    page.getByRole("button", { name: "Iniciar sesión" }),
    page.getByRole("button", { name: "Mostrar contraseña" }),
  ]) {
    const box = await target.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
  }
});

test("la landing y login no tienen violaciones axe WCAG 2.1 AA", async ({ page }) => {
  for (const path of ["/", "/login"]) {
    await page.goto(path);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      results.violations.map(({ id, impact, help }) => ({ id, impact, help })),
      `${path} presenta hallazgos axe`,
    ).toEqual([]);
  }
});

test("la metadata pública y las rutas de rastreo conservan su contrato", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Cuadre");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    "Gestión de cobros con trazabilidad financiera completa.",
  );
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://example.invalid",
  );
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", "Cuadre");
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
    "content",
    "https://example.invalid",
  );

  for (const path of ["/login", "/cambiar-contrasena"]) {
    await page.goto(path);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex,\s*nofollow/,
    );
  }

  const [robotsResponse, sitemapResponse] = await Promise.all([
    request.get("/robots.txt"),
    request.get("/sitemap.xml"),
  ]);
  expect(robotsResponse.status()).toBe(200);
  expect(await robotsResponse.text()).toContain("Sitemap: https://example.invalid/sitemap.xml");
  expect(await robotsResponse.text()).not.toMatch(
    /Disallow:\s*\/(?:login|negocio|cobrador|super-admin)/i,
  );
  expect(sitemapResponse.status()).toBe(200);
  const sitemap = await sitemapResponse.text();
  expect(sitemap).toContain("<loc>https://example.invalid/</loc>");
  expect(sitemap).not.toMatch(/<loc>[^<]*\/(?:login|negocio|cobrador|super-admin)/i);
});
