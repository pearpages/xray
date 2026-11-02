import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.{ts,tsx}"],
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**"],
      exclude: ["**/*.test.*", "**/testing/**", "packages/quality-ui/src/main.tsx"],
      reporter: ["text-summary", "lcov"],
      // A floor a little under today's figures: coverage may rise, not quietly fall.
      thresholds: { statements: 85, branches: 70, functions: 85, lines: 88 },
    },
  },
});
