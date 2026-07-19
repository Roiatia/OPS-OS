import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Pure-logic tests only — no DOM rendering — so the fast node env is enough.
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
