import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env");
const env = readFileSync(envPath, "utf8");

const passwordMatch = env.match(/postgresql:\/\/postgres(?:\.[^:]*)?:([^@]+)@/);
if (!passwordMatch) {
  console.error("Could not parse DATABASE_URL password from .env");
  process.exit(1);
}

const password = passwordMatch[1];
const ref = "mdhuxvqkgdhpolkufasn";
const regions = [
  "ap-northeast-1",
  "ap-southeast-1",
  "ap-southeast-2",
  "ap-northeast-2",
  "ap-south-1",
  "eu-central-1",
  "eu-west-1",
  "eu-west-2",
  "eu-west-3",
  "eu-north-1",
  "us-east-1",
  "us-east-2",
  "us-west-1",
  "us-west-2",
  "ca-central-1",
  "sa-east-1",
];

const poolerPrefixes = ["aws-1", "aws-0"];
const querySuffix = "?uselibpqcompat=true&sslmode=require";

for (const prefix of poolerPrefixes) {
  for (const region of regions) {
    const host = `${prefix}-${region}.pooler.supabase.com`;
    const url = `postgresql://postgres.${ref}:${password}@${host}:5432/postgres${querySuffix}`;
    try {
      execSync("npx prisma db execute --schema prisma/schema.prisma --stdin", {
        cwd: root,
        input: "SELECT 1",
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
        timeout: 20_000,
      });
      const updated = env
        .replace(/^DATABASE_URL=.*$/m, `DATABASE_URL="${url}"`)
        .replace(/^DIRECT_URL=.*$/m, `DIRECT_URL="${url}"`);
      writeFileSync(envPath, updated);
      console.log(`Connected via ${host}`);
      console.log("Updated backend/.env with pooler URLs (sslmode=require).");
      process.exit(0);
    } catch (e) {
      const msg = (e.stderr?.toString() || e.message).split("\n");
      const line =
        msg.find((l) => /FATAL|P1001|tenant|Authentication/i.test(l)) || "failed";
      console.log(`${host}: ${line.trim().slice(0, 100)}`);
    }
  }
}

console.error("\nNo pooler region worked.");
console.error("Options:");
console.error("  1. Supabase dashboard → Settings → Database → copy Session pooler URI (add ?sslmode=require)");
console.error("  2. Local Postgres: npm run db:local:setup");
process.exit(1);
