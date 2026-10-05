import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["server/**/*.test.ts"],
    environment: "node",
    setupFiles: ["server/test/setup.ts"],
    pool: "forks",
    execArgv: ["--disable-warning=ExperimentalWarning"],
  },
});
