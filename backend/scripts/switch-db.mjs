import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const mode = process.argv[2];
if (mode !== "local" && mode !== "supabase") {
  console.error("Usage: node scripts/switch-db.mjs <local|supabase>");
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env");
const env = readFileSync(envPath, "utf8");

const LOCAL_URL =
  "postgresql://postgres:postgres@localhost:5432/ops_os?schema=public";
const SUPABASE_MARKER = "# --- Supabase (remote) ---";
const LOCAL_MARKER = "# --- Local Docker Postgres ---";

function stripDbLines(text) {
  return text
    .split("\n")
    .filter(
      (line) =>
        !line.startsWith("DATABASE_URL=") &&
        !line.startsWith("DIRECT_URL=") &&
        line !== SUPABASE_MARKER &&
        line !== LOCAL_MARKER
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

if (mode === "local") {
  const supabaseUrl = env.match(/^DATABASE_URL="(.+)"$/m)?.[1];
  const supabaseDirect = env.match(/^DIRECT_URL="(.+)"$/m)?.[1];
  let next = stripDbLines(env);
  if (supabaseUrl && !next.includes("SUPABASE_DATABASE_URL")) {
    next += `\n# Saved Supabase URLs (restore with: npm run db:use-supabase)\nSUPABASE_DATABASE_URL="${supabaseUrl}"\nSUPABASE_DIRECT_URL="${supabaseDirect ?? supabaseUrl}"\n`;
  }
  next =
    `${LOCAL_MARKER}\nDATABASE_URL="${LOCAL_URL}"\nDIRECT_URL="${LOCAL_URL}"\n\n` +
    next.trim() +
    "\n";
  writeFileSync(envPath, next);
  console.log("Switched backend/.env to local Docker Postgres (localhost:5432/ops_os).");
  console.log("Run: npm run db:local:setup");
} else {
  const supabaseUrl = env.match(/^SUPABASE_DATABASE_URL="(.+)"$/m)?.[1];
  const supabaseDirect = env.match(/^SUPABASE_DIRECT_URL="(.+)"$/m)?.[1];
  if (!supabaseUrl) {
    console.error("No SUPABASE_DATABASE_URL saved in .env. Paste your Supabase URI manually.");
    process.exit(1);
  }
  let next = stripDbLines(env);
  next =
    `${SUPABASE_MARKER}\nDATABASE_URL="${supabaseUrl}"\nDIRECT_URL="${supabaseDirect ?? supabaseUrl}"\n\n` +
    next.trim() +
    "\n";
  writeFileSync(envPath, next);
  console.log("Restored Supabase URLs in backend/.env.");
}
