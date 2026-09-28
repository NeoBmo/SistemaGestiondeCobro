import { expect, test } from "@playwright/test";

const areas = [
  { path: "/", heading: "Cuadre" },
  { path: "/login", heading: "Iniciar sesión" },
  { path: "/super-admin", heading: "Super Admin" },
  { path: "/negocio", heading: "Negocio" },
  { path: "/cobrador", heading: "Cobrador" },
];

for (const { path, heading } of areas) {
  test(`${path} responde 200 con su título y un único landmark main`, async ({ page }) => {
    const response = await page.goto(path);

    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.getByRole("main")).toHaveCount(1);
  });
}

test("GET /api/health responde ok y sin caché", async ({ request }) => {
  const response = await request.get("/api/health");

  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect(await response.json()).toEqual({ status: "ok" });
});

test("«Saltar al contenido» es el primer foco del teclado y se hace visible", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");

  const skipLink = page.getByRole("link", { name: "Saltar al contenido" });
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeVisible();
});

test("ninguna área provoca scroll horizontal en el viewport actual", async ({ page }) => {
  for (const { path } of areas) {
    await page.goto(path);
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );

    expect(overflows, path).toBe(false);
  }
});
