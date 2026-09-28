import { configDefaults, defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Integración (requiere Supabase local) y e2e tienen sus propios comandos.
    exclude: [...configDefaults.exclude, "src/tests/integration/**", "src/tests/e2e/**"],
  },
});
