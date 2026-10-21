import { defineConfig, devices } from "@playwright/test";
import { readLocalSupabase } from "./src/tests/e2e/support/local-supabase";

const PORT = 3100;
const baseURL = `http://127.0.0.1:${PORT}`;

// Con Supabase local corriendo (npm run db:start) la app usa el real y se ejecutan los recorridos con
// sesión (journeys.spec.ts); sin él, valores ficticios: los smoke tests no consultan Supabase ni la BD,
// solo hace falta que el arranque (instrumentation) encuentre un entorno válido. En CI
// E2E_REQUIRE_SUPABASE=1 convierte un Supabase caído en error, no en recorridos omitidos.
const supabase = readLocalSupabase({ required: process.env.E2E_REQUIRE_SUPABASE === "1" });
process.env.E2E_REAL_SUPABASE = supabase ? "1" : "";
if (supabase) {
  // Los workers heredan estas variables: las usan los fixtures de los recorridos (helpers de integración).
  process.env.TEST_SUPABASE_URL = supabase.url;
  process.env.TEST_SUPABASE_ANON_KEY = supabase.anonKey;
  process.env.TEST_SUPABASE_SERVICE_ROLE_KEY = supabase.serviceRoleKey;
}

const e2eEnv = {
  NEXT_PUBLIC_SUPABASE_URL: supabase?.url ?? "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: supabase?.anonKey ?? "e2e-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: supabase?.serviceRoleKey ?? "e2e-service-role-key",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  AUTH_SYNTHETIC_EMAIL_DOMAIN: "cuadre.invalid",
};

export default defineConfig({
  testDir: "./src/tests/e2e",
  // Con todos los recorridos en paralelo (y next dev compilando), los 5 s por defecto se quedan cortos.
  expect: { timeout: 15_000 },
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
