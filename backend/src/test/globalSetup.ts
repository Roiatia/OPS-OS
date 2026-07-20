import { execSync } from "node:child_process";

/**
 * Runs once before the whole suite. When a disposable test database is
 * configured (DATABASE_URL_TEST), materialize the Prisma schema on it so the
 * Layer 2 workflow tests have real tables. When it is absent this is a no-op
 * and those tests skip themselves.
 */
export default function setup() {
  const testDbUrl = process.env.DATABASE_URL_TEST;
  if (!testDbUrl) return;

  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    stdio: "inherit",
    // schema.prisma references both DATABASE_URL and DIRECT_URL.
    env: { ...process.env, DATABASE_URL: testDbUrl, DIRECT_URL: testDbUrl },
  });
}
