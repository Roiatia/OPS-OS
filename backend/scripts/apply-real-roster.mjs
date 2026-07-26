/**
 * One-shot: replace demo supervisor / SL / OPS / graphics-leader identities
 * with the real roster. Leaves QA + inspectors untouched.
 *
 * Usage (Cloud SQL Auth Proxy on :5433):
 *   node scripts/apply-real-roster.mjs
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = readFileSync(join(root, ".env"), "utf8");
const url = env.match(/^DATABASE_URL="(.+)"$/m)?.[1];
if (!url) {
  console.error("No DATABASE_URL in backend/.env");
  process.exit(1);
}

/** @type {{ email: string, name: string, role: string }[]} */
const REAL_ROSTER = [
  // Ops / graphics leadership
  { email: "magali@ops-demo.local", name: "Magali", role: "OPS_ADMIN" },
  { email: "natali@ops-demo.local", name: "Natali", role: "OPS_MANAGER_2" },
  { email: "eitan@ops-demo.local", name: "Eitan", role: "GRAPHIC_TEAM_LEADER" },

  // Shift leaders
  { email: "zach@ops-demo.local", name: "Zach", role: "SUPERVISOR_SHIFT_LEADER" },
  { email: "sean@ops-demo.local", name: "Sean", role: "SUPERVISOR_SHIFT_LEADER" },
  { email: "rachel@ops-demo.local", name: "Rachel", role: "SUPERVISOR_SHIFT_LEADER" },
  { email: "tom@ops-demo.local", name: "Tom", role: "SUPERVISOR_SHIFT_LEADER" },
  { email: "erez@ops-demo.local", name: "Erez", role: "SUPERVISOR_SHIFT_LEADER" },
  { email: "talia@ops-demo.local", name: "Talia", role: "SUPERVISOR_SHIFT_LEADER" },
  { email: "oren@ops-demo.local", name: "Oren", role: "SUPERVISOR_SHIFT_LEADER" },
  { email: "aviad@ops-demo.local", name: "Aviad", role: "SUPERVISOR_SHIFT_LEADER" },

  // Supervisors
  { email: "igor@ops-demo.local", name: "Igor", role: "SUPERVISOR" },
  { email: "noam@ops-demo.local", name: "Noam", role: "SUPERVISOR" },
  { email: "ron@ops-demo.local", name: "Ron", role: "SUPERVISOR" },
  { email: "noam-a@ops-demo.local", name: "Noam A", role: "SUPERVISOR" },
  { email: "bashar@ops-demo.local", name: "Bashar", role: "SUPERVISOR" },
  { email: "george@ops-demo.local", name: "George", role: "SUPERVISOR" },
  { email: "omer@ops-demo.local", name: "Omer", role: "SUPERVISOR" },
  { email: "noam-bs@ops-demo.local", name: "Noam BS", role: "SUPERVISOR" },
  { email: "rivka@ops-demo.local", name: "Rivka", role: "SUPERVISOR" },
  { email: "elodie@ops-demo.local", name: "Elodie", role: "SUPERVISOR" },
  { email: "millie@ops-demo.local", name: "Millie", role: "SUPERVISOR" },
  { email: "roi@ops-demo.local", name: "Roi", role: "SUPERVISOR" },
  { email: "bashar-m@ops-demo.local", name: "Bashar M", role: "SUPERVISOR" },
  { email: "tomer@ops-demo.local", name: "Tomer", role: "SUPERVISOR" },
  { email: "eyal@ops-demo.local", name: "Eyal", role: "SUPERVISOR" },
  { email: "cosmin@ops-demo.local", name: "Cosmin", role: "SUPERVISOR" },
  { email: "sinai@ops-demo.local", name: "Sinai", role: "SUPERVISOR" },
  { email: "tal@ops-demo.local", name: "Tal", role: "SUPERVISOR" },
  { email: "chen@ops-demo.local", name: "Chen", role: "SUPERVISOR" },
  { email: "roni@ops-demo.local", name: "Roni", role: "SUPERVISOR" },
  { email: "lior@ops-demo.local", name: "Lior", role: "SUPERVISOR" },
  { email: "yaron@ops-demo.local", name: "Yaron", role: "SUPERVISOR" },
  { email: "kristina@ops-demo.local", name: "Kristina", role: "SUPERVISOR" },
];

/**
 * Prefer renaming existing rows so FK assignment history stays attached.
 * Each source email is remapped once.
 */
const REMAP_EXISTING = [
  { fromEmail: "ops@ops-demo.local", toEmail: "magali@ops-demo.local" },
  { fromEmail: "ops2@ops-demo.local", toEmail: "natali@ops-demo.local" },
  { fromEmail: "leader@ops-demo.local", toEmail: "eitan@ops-demo.local" },
  { fromEmail: "supervisor2@ops-demo.local", toEmail: "zach@ops-demo.local" },
  { fromEmail: "plan-sl-03@ops-demo.local", toEmail: "rachel@ops-demo.local" },
  { fromEmail: "plan-sl-01@ops-demo.local", toEmail: "erez@ops-demo.local" },
  { fromEmail: "plan-sl-02@ops-demo.local", toEmail: "oren@ops-demo.local" },
  { fromEmail: "supervisor@ops-demo.local", toEmail: "igor@ops-demo.local" },
  { fromEmail: "supervisor3@ops-demo.local", toEmail: "noam@ops-demo.local" },
  { fromEmail: "plan-sup-02@ops-demo.local", toEmail: "bashar@ops-demo.local" },
  { fromEmail: "plan-sup-01@ops-demo.local", toEmail: "eyal@ops-demo.local" },
  { fromEmail: "plan-sup-03@ops-demo.local", toEmail: "cosmin@ops-demo.local" },
  { fromEmail: "supervisor4@ops-demo.local", toEmail: "lior@ops-demo.local" },
];

const KEEP_ROLES = new Set(["MAPPING_INSPECTOR", "GRAPHIC_QA"]);

function cuidLike() {
  // Prisma default is cuid; for inserts we can use crypto random id-ish string.
  return `cmr${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

const db = new pg.Client({ connectionString: url, connectionTimeoutMillis: 20_000 });

await db.connect();
await db.query("BEGIN");

try {
  // 1) Remap existing placeholder accounts → real emails (preserve ids / FKs)
  for (const { fromEmail, toEmail } of REMAP_EXISTING) {
    const target = REAL_ROSTER.find((p) => p.email === toEmail);
    if (!target) throw new Error(`Missing roster entry for remap ${toEmail}`);

    const { rows: existing } = await db.query(`SELECT id, email, name FROM "User" WHERE email = $1`, [
      fromEmail,
    ]);
    if (existing.length === 0) {
      console.log(`  skip remap (missing): ${fromEmail}`);
      continue;
    }

    const { rows: conflict } = await db.query(`SELECT id FROM "User" WHERE email = $1`, [toEmail]);
    if (conflict.length > 0 && conflict[0].id !== existing[0].id) {
      throw new Error(`Email already taken for remap ${fromEmail} → ${toEmail}`);
    }

    await db.query(`UPDATE "User" SET email = $1, name = $2 WHERE id = $3`, [
      toEmail,
      target.name,
      existing[0].id,
    ]);

    // Ensure exact role for this identity (drop other non-QA/inspector roles)
    await db.query(
      `DELETE FROM "UserRole"
       WHERE "userId" = $1
         AND role::text <> ALL($2::text[])`,
      [existing[0].id, [...KEEP_ROLES]]
    );
    await db.query(
      `INSERT INTO "UserRole" (id, "userId", role)
       VALUES ($1, $2, $3::"RoleName")
       ON CONFLICT ("userId", role) DO NOTHING`,
      [cuidLike(), existing[0].id, target.role]
    );

    console.log(`  remapped ${fromEmail} → ${target.name} <${toEmail}> [${target.role}]`);
  }

  // 2) Upsert remaining roster people
  for (const person of REAL_ROSTER) {
    const { rows } = await db.query(`SELECT id FROM "User" WHERE email = $1`, [person.email]);
    let userId;
    if (rows.length === 0) {
      userId = cuidLike();
      await db.query(
        `INSERT INTO "User" (id, email, name, "fridayContract", "sundayOk", "hagimOk", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, false, true, false, NOW(), NOW())`,
        [userId, person.email, person.name]
      );
      console.log(`  created ${person.name} <${person.email}> [${person.role}]`);
    } else {
      userId = rows[0].id;
      await db.query(`UPDATE "User" SET name = $1 WHERE id = $2`, [person.name, userId]);
    }

    await db.query(
      `DELETE FROM "UserRole"
       WHERE "userId" = $1
         AND role::text <> ALL($2::text[])`,
      [userId, [...KEEP_ROLES]]
    );
    await db.query(
      `INSERT INTO "UserRole" (id, "userId", role)
       VALUES ($1, $2, $3::"RoleName")
       ON CONFLICT ("userId", role) DO NOTHING`,
      [cuidLike(), userId, person.role]
    );
  }

  // 3) Remove leftover demo supervisor/SL/ops/leader accounts that are not in the real roster
  //    (keep inspectors + QA).
  const keepEmails = REAL_ROSTER.map((p) => p.email);
  const { rows: leftovers } = await db.query(
    `SELECT u.id, u.email, u.name, array_agg(ur.role::text ORDER BY ur.role::text) AS roles
     FROM "User" u
     JOIN "UserRole" ur ON ur."userId" = u.id
     WHERE u.email LIKE '%@ops-demo.local'
       AND u.email <> ALL($1::text[])
     GROUP BY u.id, u.email, u.name
     HAVING bool_or(ur.role::text = ANY($2::text[]))
        AND NOT bool_or(ur.role::text = ANY($3::text[]))`,
    [
      keepEmails,
      ["SUPERVISOR", "SUPERVISOR_SHIFT_LEADER", "OPS_ADMIN", "OPS_MANAGER", "OPS_MANAGER_2", "GRAPHIC_TEAM_LEADER"],
      [...KEEP_ROLES],
    ]
  );

  for (const row of leftovers) {
    // Soft-safe: only delete if they have no map assignment FKs; otherwise just strip roles + rename retired
    const { rows: mapRefs } = await db.query(
      `SELECT
         (SELECT count(*)::int FROM "Map" WHERE "assignedSupervisorId" = $1) +
         (SELECT count(*)::int FROM "Map" WHERE "assignedInspectorId" = $1) +
         (SELECT count(*)::int FROM "Map" WHERE "assignedQaId" = $1) AS n`,
      [row.id]
    );
    if (mapRefs[0].n > 0) {
      console.log(`  keep leftover with map refs: ${row.name} <${row.email}>`);
      continue;
    }
    await db.query(`DELETE FROM "User" WHERE id = $1`, [row.id]);
    console.log(`  deleted leftover ${row.name} <${row.email}>`);
  }

  await db.query("COMMIT");

  const { rows: finalRows } = await db.query(
    `SELECT u.name, u.email, array_agg(ur.role::text ORDER BY ur.role::text) AS roles
     FROM "User" u
     JOIN "UserRole" ur ON ur."userId" = u.id
     WHERE ur.role::text = ANY($1::text[])
     GROUP BY u.id, u.name, u.email
     ORDER BY min(ur.role::text), u.name`,
    [
      [
        "OPS_ADMIN",
        "OPS_MANAGER_2",
        "GRAPHIC_TEAM_LEADER",
        "SUPERVISOR_SHIFT_LEADER",
        "SUPERVISOR",
      ],
    ]
  );
  console.log("\nFinal ops / graphics / supervisor roster:");
  console.table(finalRows);
} catch (err) {
  await db.query("ROLLBACK");
  console.error(err);
  process.exitCode = 1;
} finally {
  await db.end();
}
