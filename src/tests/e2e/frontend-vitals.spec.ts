import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, test } from "@playwright/test";

const webVitalsScript = join(dirname(require.resolve("web-vitals")), "web-vitals.iife.js");
const webVitalsSource = readFileSync(webVitalsScript, "utf8");
const webVitalsBootstrap = webVitalsSource.replace(/^var webVitals=/, "window.webVitals=");
if (webVitalsBootstrap === webVitalsSource) {
  throw new Error("No se pudo preparar el bundle IIFE de web-vitals para Playwright");
}

type Vital = { name: "LCP" | "INP" | "CLS"; value: number; id: string };

test("landing: adjunta cinco muestras locales de LCP, INP y CLS", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Métricas de baseline solo en Chromium desktop");

  const samples: Vital[][] = [];
  for (let index = 0; index < 5; index += 1) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const reported: Vital[] = [];
    await page.exposeFunction("__reportWebVital", (metric: Vital) => reported.push(metric));
    await page.addInitScript({
      content:
        `${webVitalsBootstrap}\n;(() => {` +
        `
      const browserWindow = window;
      const runtime = browserWindow.webVitals;
      if (!runtime) throw new Error("web-vitals no se inicializó en el documento");
      const options = { reportAllChanges: true };
      const report = (metric) =>
        void browserWindow.__reportWebVital({ name: metric.name, value: metric.value, id: metric.id });
      runtime.onLCP(report, options);
      runtime.onINP(report, options);
      runtime.onCLS(report, options);
    })();`,
    });

    await page.goto("/");
    await page.evaluate(async () => {
      await document.fonts.ready;
    });

    const loginPagePromise = context.waitForEvent("page");
    await page
      .getByRole("link", { name: "Iniciar sesión" })
      .first()
      .click({ modifiers: ["Control"] });
    const loginPage = await loginPagePromise;
    await expect(loginPage).toHaveURL(/\/login$/);
    await expect.poll(() => reported.some((metric) => metric.name === "INP")).toBe(true);

    const hasLayoutShift = await page.evaluate(() =>
      performance
        .getEntriesByType("layout-shift")
        .some((entry) => !(entry as PerformanceEntry & { hadRecentInput: boolean }).hadRecentInput),
    );

    // web-vitals finaliza LCP/CLS cuando el documento se oculta; una navegación real
    // fuerza pagehide. getEntriesByType no expone entradas observer-only como LCP.
    await page.goto("/login");
    await expect.poll(() => reported.some((metric) => metric.name === "LCP")).toBe(true);
    if (!reported.some((metric) => metric.name === "CLS")) {
      expect(hasLayoutShift, `la muestra ${index + 1} tuvo shifts pero no reportó CLS`).toBe(false);
      reported.push({ name: "CLS", value: 0, id: "sin-layout-shift" });
    }
    await loginPage.close();
    await page.close();
    await context.close();
    samples.push(reported);
  }

  const metrics = ["LCP", "INP", "CLS"] as const;
  const summarize = (name: (typeof metrics)[number]) => {
    const values = samples.flatMap((sample) =>
      sample.filter((metric) => metric.name === name).map((metric) => metric.value),
    );
    const sorted = [...values].sort((a, b) => a - b);
    return {
      availableSamples: values.length,
      median: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
      min: sorted[0] ?? null,
      max: sorted.at(-1) ?? null,
    };
  };
  const summary = { LCP: summarize("LCP"), INP: summarize("INP"), CLS: summarize("CLS") };

  await testInfo.attach("landing-web-vitals-lab.json", {
    body: JSON.stringify(
      {
        environment: "Playwright Chromium; local production build; lab only",
        viewport: { width: 1280, height: 900 },
        interaction: "Ctrl+click Iniciar sesión mantiene viva la landing para capturar LCP e INP",
        sampleCount: 5,
        targets: {
          LCP: "<= 2500 ms",
          INP: "<= 200 ms (lab; not field/CrUX)",
          CLS: "reported; no approved threshold",
        },
        summary,
        samples,
      },
      null,
      2,
    ),
    contentType: "application/json",
  });

  expect(samples).toHaveLength(5);
  for (const [index, sample] of samples.entries()) {
    expect(
      new Set(sample.map((metric) => metric.name)),
      `muestra ${index + 1} debe incluir LCP, INP y CLS`,
    ).toEqual(new Set(metrics));
  }
  expect(summary.LCP.median).not.toBeNull();
  expect(summary.INP.median).not.toBeNull();
  expect(summary.LCP.median).toBeLessThanOrEqual(2500);
  expect(summary.INP.median).toBeLessThanOrEqual(200);
});
