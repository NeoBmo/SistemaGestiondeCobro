import { expect, test } from "@playwright/test";

// Humo sin Supabase real: el entorno de Playwright usa URLs ficticias. Sin cookies de sesión ninguna
// página hace llamadas de red, así que las redirecciones y las páginas públicas se pueden probar aquí.
// Los recorridos con sesión real (login, cambio de contraseña, panel) van en T1.6 con Supabase local.

const publicPages = [
  { path: "/", heading: "Cuadre" },
  { path: "/login", heading: "Iniciar sesión" },
];

const privatePages = ["/super-admin", "/negocio", "/cobrador", "/cambiar-contrasena"];

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

test("el formulario de login tiene etiquetas asociadas y se envía con el teclado", async ({
  page,
}) => {
  await page.goto("/login");

  await page.getByLabel("Usuario").fill("alguien");
  await page.getByLabel(/^Contraseña/).fill("Clave12345");
  await page.getByLabel(/^Contraseña/).press("Enter");

  // Sin Supabase real la respuesta es un error; lo importante es que se anuncia, no que desaparezca.
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("alert")).not.toContainText(/stack|\b50\d\b|undefined/i);
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

test("las páginas públicas no provocan scroll horizontal en el viewport actual", async ({
  page,
}) => {
  for (const { path } of publicPages) {
    await page.goto(path);
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );

    expect(overflows, path).toBe(false);
  }
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
