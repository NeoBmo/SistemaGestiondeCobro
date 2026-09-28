import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const baseURL = `http://127.0.0.1:${PORT}`;

// Valores ficticios: los smoke tests no consultan Supabase ni la BD; solo hace falta que el
// arranque (instrumentation) encuentre un entorno válido. Tienen prioridad sobre .env.local.
const e2eEnv = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "e2e-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "e2e-service-role-key",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  AUTH_SYNTHETIC_EMAIL_DOMAIN: "cuadre.invalid",
};

export default defineConfig({
  testDir: "./src/tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL, trace: "on-first-retry" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    // El perfil Cobrador es mobile-first (frontend-design.md §1).
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `npm run build && npm run start -- --hostname 127.0.0.1 --port ${PORT}`,
    url: `${baseURL}/api/health`,
    env: e2eEnv,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
