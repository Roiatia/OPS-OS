import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const mode = process.argv[2];
if (mode !== "local" && mode !== "cloudsql" && mode !== "supabase") {
  console.error("Usage: node scripts/switch-db.mjs <cloudsql|local|supabase>");
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env");
const env = readFileSync(envPath, "utf8");

const LOCAL_URL =
  "postgresql://postgres:postgres@localhost:5432/ops_os?schema=public";
const CLOUDSQL_MARKER = "# --- Cloud SQL (Auth Proxy on :5433) ---";
const LOCAL_MARKER = "# --- Local Docker Postgres ---";
const SUPABASE_MARKER = "# --- Supabase (remote) ---";

function cloudSqlUrl(password) {
  const encoded = encodeURIComponent(password);
  return `postgresql://ops_dev:${encoded}@127.0.0.1:5433/postgres`;
}

function stripDbLines(text) {
  return text
    .split("\n")
    .filter(
      (line) =>
        !line.startsWith("DATABASE_URL=") &&
        !line.startsWith("DIRECT_URL=") &&
        line !== CLOUDSQL_MARKER &&
        line !== LOCAL_MARKER &&
        line !== SUPABASE_MARKER
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

function currentDatabaseUrl(text) {
  return text.match(/^DATABASE_URL="(.+)"$/m)?.[1];
}

function currentDirectUrl(text) {
  return text.match(/^DIRECT_URL="(.+)"$/m)?.[1];
}

function saveRemoteIfNeeded(next, currentUrl, currentDirect) {
  if (!currentUrl) return next;
  // Already a saved Cloud SQL or Supabase backup — don't nest.
  if (next.includes("CLOUD_SQL_DATABASE_URL=") || next.includes("SUPABASE_DATABASE_URL=")) {
    return next;
  }
  if (currentUrl.includes("127.0.0.1:5433") || currentUrl.includes("localhost:5433")) {
    return (
      next +
      `\n# Saved Cloud SQL URLs (restore with: npm run db:use-cloudsql)\n` +
      `CLOUD_SQL_DATABASE_URL="${currentUrl}"\n` +
      `CLOUD_SQL_DIRECT_URL="${currentDirect ?? currentUrl}"\n`
    );
  }
  if (/supabase\.com|pooler\.supabase/.test(currentUrl)) {
    return (
      next +
      `\n# Saved Supabase URLs (legacy — restore with: npm run db:use-supabase)\n` +
      `SUPABASE_DATABASE_URL="${currentUrl}"\n` +
      `SUPABASE_DIRECT_URL="${currentDirect ?? currentUrl}"\n`
    );
  }
  return next;
}

function writeActive(marker, databaseUrl, directUrl, base) {
  const next =
    `${marker}\nDATABASE_URL="${databaseUrl}"\nDIRECT_URL="${directUrl}"\n\n` +
    base.trim() +
    "\n";
  writeFileSync(envPath, next);
}

const activeUrl = currentDatabaseUrl(env);
const activeDirect = currentDirectUrl(env);

if (mode === "local") {
  let next = stripDbLines(env);
  next = saveRemoteIfNeeded(next, activeUrl, activeDirect);
  writeActive(LOCAL_MARKER, LOCAL_URL, LOCAL_URL, next);
  console.log("Switched backend/.env to local Docker Postgres (localhost:5432/ops_os).");
  console.log("Run: npm run db:local:setup");
} else if (mode === "cloudsql") {
  const savedUrl = env.match(/^CLOUD_SQL_DATABASE_URL="(.+)"$/m)?.[1];
  const savedDirect = env.match(/^CLOUD_SQL_DIRECT_URL="(.+)"$/m)?.[1];
  const password = env.match(/^CLOUD_SQL_PASSWORD="(.+)"$/m)?.[1];

  let databaseUrl = savedUrl;
  let directUrl = savedDirect ?? savedUrl;

  if (!databaseUrl && password) {
    databaseUrl = cloudSqlUrl(password);
    directUrl = databaseUrl;
  }

  if (!databaseUrl && activeUrl && /127\.0\.0\.1:5433|localhost:5433/.test(activeUrl)) {
    databaseUrl = activeUrl;
    directUrl = activeDirect ?? activeUrl;
  }

  if (!databaseUrl) {
    console.error(
      "No Cloud SQL URL available. Add one of these to backend/.env, then retry:\n" +
        '  CLOUD_SQL_PASSWORD="<ops_dev password from Eyal F.>"\n' +
        "  or CLOUD_SQL_DATABASE_URL=postgresql://ops_dev:...@127.0.0.1:5433/postgres"
    );
    process.exit(1);
  }

  let next = stripDbLines(env);
  writeActive(CLOUDSQL_MARKER, databaseUrl, directUrl ?? databaseUrl, next);
  console.log("Switched backend/.env to Cloud SQL Auth Proxy (127.0.0.1:5433).");
  console.log(
    "Start proxy: cloud-sql-proxy --gcloud-auth --port 5433 ops-tools-503212:europe-west3:ops-os-db"
  );
} else {
  const supabaseUrl = env.match(/^SUPABASE_DATABASE_URL="(.+)"$/m)?.[1];
  const supabaseDirect = env.match(/^SUPABASE_DIRECT_URL="(.+)"$/m)?.[1];
  if (!supabaseUrl) {
    console.error(
      "No SUPABASE_DATABASE_URL saved in .env. Supabase is legacy — use npm run db:use-cloudsql."
    );
    process.exit(1);
  }
  let next = stripDbLines(env);
  writeActive(SUPABASE_MARKER, supabaseUrl, supabaseDirect ?? supabaseUrl, next);
  console.log("Restored Supabase URLs in backend/.env (legacy).");
}
