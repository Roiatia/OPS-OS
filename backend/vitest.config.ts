import { defineConfig } from "vitest/config";

// Layer 2 (workflow state-machine) tests talk to a real disposable Postgres via
// DATABASE_URL_TEST. When it is set we point Prisma at it (the client reads
// DATABASE_URL at construction) and run the schema push once in globalSetup.
// When it is absent those tests skip themselves, so Layer 1 always runs.
const testDbUrl = process.env.DATABASE_URL_TEST;

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globalSetup: ["src/test/globalSetup.ts"],
    ...(testDbUrl ? { env: { DATABASE_URL: testDbUrl, DIRECT_URL: testDbUrl } } : {}),
  },
});
