import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/*/test/**/*.test.ts",
      "harness/test/**/*.test.ts",
    ],
    globals: false,
    environment: "node",
    pool: "threads",
  },
});
