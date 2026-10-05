import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["web/src/**/*.test.ts"],
    environment: "node",
    setupFiles: ["web/src/core/test/setup.ts"],
  },
});
