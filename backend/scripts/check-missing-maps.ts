/**
 * Check whether building / map numbers exist in the database.
 * Prints only missing map numbers (one per line). Prints "all found" if none are missing.
 *
 * Usage:
 *   npx tsx scripts/check-missing-maps.ts 4041 4754 8191
 *   npx tsx scripts/check-missing-maps.ts --file buildings.txt
 *   pbpaste | npx tsx scripts/check-missing-maps.ts
 *   npm run db:check-missing-maps -- --file buildings.txt
 *
 * Tip: do NOT paste a multiline list after the command — zsh will run each line
 * as a separate command. Put numbers in a file or pipe them instead.
 */
import { readFileSync } from "fs";
import { checkMapsInDatabase } from "../src/services/mapPresence.js";

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (c) => chunks.push(Buffer.from(c)));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

function splitList(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function main() {
  const args = process.argv.slice(2);
  let inputs: string[] = [];

  if (args[0] === "--stdin" || (args.length === 0 && !process.stdin.isTTY)) {
    inputs = splitList(await readStdin());
  } else if (args[0] === "--file") {
    const path = args[1];
    if (!path) {
      console.error("Usage: --file <path>");
      process.exit(1);
    }
    inputs = splitList(readFileSync(path, "utf8"));
  } else if (args.length > 0) {
    inputs = args;
  }

  if (inputs.length === 0) {
    console.error(
      "Usage:\n" +
        "  Put numbers in a file, then:\n" +
        "    npm run db:check-missing-maps -- --file buildings.txt\n" +
        "  Or pipe them:\n" +
        "    pbpaste | npm run db:check-missing-maps -- --stdin\n" +
        "  Or pass a few on one line:\n" +
        "    npm run db:check-missing-maps -- 4041 4754 8191\n\n" +
        "Do not paste a multiline list after the command — the shell will try to run each line."
    );
    process.exit(1);
  }

  const result = await checkMapsInDatabase(inputs);

  if (result.missing.length === 0) {
    console.log("all found");
    process.exit(0);
  }

  for (const n of result.missing) {
    console.log(n);
  }

  process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
