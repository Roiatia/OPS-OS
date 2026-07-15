#!/usr/bin/env node
/**
 * One-shot setup for OPS Hub demo testing:
 * - apply pending migrations (including schema repair)
 * - restore demo users + today's shift (Alex + Dana on shift)
 * - replace maps with full hub demo set
 */
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function run(cmd, args) {
  console.log(`\n> ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: false });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run("npx", ["prisma", "migrate", "deploy"]);
run("npx", ["tsx", "prisma/seed.ts"]);
run("npx", ["tsx", "prisma/reseed-demo-maps.ts"]);

console.log("\n✓ Hub demo ready.");
console.log("  OPS manager:  ops@ops-demo.local / ops2@ops-demo.local");
console.log("  On shift today:");
console.log("    • supervisor@ops-demo.local  (Alex)");
console.log("    • supervisor2@ops-demo.local (Dana — shift leader)");
console.log("    • supervisor3@ops-demo.local (Noam)");
console.log("  Off shift: supervisor4@ops-demo.local (Lior)");
console.log("  Log out and log in again if you still see role errors.");
