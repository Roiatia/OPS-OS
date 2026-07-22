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
  } else if (
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "ETIMEDOUT" ||
    /P1001|Can't reach|timeout|ECONNRESET/i.test(message)
  ) {
    console.error(
      "Cannot reach database — for Cloud SQL start the Auth Proxy, then retry:\n" +
        "  cloud-sql-proxy --gcloud-auth --port 5433 ops-tools-503212:europe-west3:ops-os-db\n" +
        "  npm run db:use-cloudsql\n" +
        "Or use local Docker: npm run db:local:setup"
    );
  } else if (code === "28P01" || /password authentication failed/i.test(message)) {
    console.error(
      "Wrong database password — update ops_dev password in backend/.env (ask Eyal F.)."
    );
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
