import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Pins env + a throwaway DATA_DIR before any app code loads.
    setupFiles: ["src/test/setup.ts"],
    // One process per test file, so each file gets its own fresh database.
    pool: "forks",
    isolate: true,
  },
});
