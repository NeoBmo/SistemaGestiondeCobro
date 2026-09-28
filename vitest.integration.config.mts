import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/** Pruebas contra Postgres real (Supabase local). Requiere `npm run db:start`. */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/tests/integration/**/*.test.ts"],
    globalSetup: ["./src/tests/integration/global-setup.ts"],
    // Comparten una base de datos y varias prueban concurrencia: se ejecutan de una en una.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
