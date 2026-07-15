import { readFileSync } from "fs";
import pg from "pg";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env");
const env = readFileSync(envPath, "utf8");
const urlMatch = env.match(/^DATABASE_URL="(.+)"$/m);

if (!urlMatch) {
  console.error("No DATABASE_URL in backend/.env");
  process.exit(1);
}

const url = urlMatch[1];
const client = new pg.Client({
  connectionString: url,
  connectionTimeoutMillis: 12_000,
});

try {
  await client.connect();
  await client.query("SELECT 1");
  console.log("Database connection OK.");
  process.exit(0);
} catch (err) {
  const code = err.code ?? "";
  const message = err.message ?? String(err);
  console.error("Database connection failed.");
  if (code === "SELF_SIGNED_CERT_IN_CHAIN" || /certificate/i.test(message)) {
    console.error(
      "SSL certificate issue — append to DATABASE_URL and DIRECT_URL in .env:\n" +
        "  ?uselibpqcompat=true&sslmode=require"
    );
  } else if (code === "ENOTFOUND" || /P1001|Can't reach/i.test(message)) {
    console.error(
      "Cannot reach host — check Supabase project is not paused, or run:\n" +
        "  npm run db:find-pooler\n" +
        "  npm run db:local:setup   (Docker Postgres fallback)"
    );
  } else if (code === "28P01" || /password authentication failed/i.test(message)) {
    console.error("Wrong database password — update backend/.env from Supabase dashboard.");
  } else {
    console.error(message);
  }
  process.exit(1);
} finally {
  try {
    await client.end();
  } catch {
    /* ignore */
  }
}
