import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

/**
 * Enterprise test configuration.
 *
 * Node environment: everything under test is server-side business logic (pure
 * scoring, time maths, cache policy, generators). UI is covered by the build +
 * live regression, not by DOM tests.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: { provider: "v8", reporter: ["text", "json-summary"], include: ["src/lib/**", "src/server/**"] },
  },
  resolve: { alias: { "@": resolve(__dirname, "./src") } },
});
