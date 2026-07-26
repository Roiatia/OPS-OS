import { prisma } from "./prisma.js";

/**
 * Cloud SQL may lag behind the Super Admin schema (migrations require elevated
 * privileges for RoleName, and admin_features_metrics may not be applied yet).
 * These probes let auth and admin routes degrade instead of crashing every
 * User SELECT that includes the missing `active` column.
 *
 * Positive results are cached for the process lifetime (columns/tables won't
 * disappear). Negative results use a short TTL so applying migrations while
 * the server is running is picked up without a full restart.
 */

const NEGATIVE_TTL_MS = 15_000;

let userActiveColumn: boolean | null = null;
let userActiveCheckedAt = 0;
let adminTables: boolean | null = null;
let adminTablesCheckedAt = 0;

function negativeCacheFresh(checkedAt: number): boolean {
  return Date.now() - checkedAt < NEGATIVE_TTL_MS;
}

export async function hasUserActiveColumn(): Promise<boolean> {
  if (userActiveColumn === true) return true;
  if (userActiveColumn === false && negativeCacheFresh(userActiveCheckedAt)) {
    return false;
  }
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ ok: number }>>(
      `SELECT 1 AS ok FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'User' AND column_name = 'active'
       LIMIT 1`
    );
    userActiveColumn = rows.length > 0;
  } catch {
    userActiveColumn = false;
  }
  userActiveCheckedAt = Date.now();
  if (!userActiveColumn) {
    console.warn(
      "[schema] User.active is missing — soft-disable is disabled until migration 20260722161000_admin_features_metrics is applied"
    );
  }
  return userActiveColumn;
}

export async function hasAdminFeatureTables(): Promise<boolean> {
  if (adminTables === true) return true;
  if (adminTables === false && negativeCacheFresh(adminTablesCheckedAt)) {
    return false;
  }
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ ok: number }>>(
      `SELECT 1 AS ok FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'FeatureFlag'
       LIMIT 1`
    );
    adminTables = rows.length > 0;
  } catch {
    adminTables = false;
  }
  adminTablesCheckedAt = Date.now();
  return adminTables;
}

/** Soft-disable check that works with or without the column (and with client omit). */
export async function isAccountDisabled(userId: string): Promise<boolean> {
  if (!(await hasUserActiveColumn())) return false;
  const rows = await prisma.$queryRawUnsafe<Array<{ active: boolean }>>(
    `SELECT active FROM "User" WHERE id = $1 LIMIT 1`,
    userId
  );
  return rows[0]?.active === false;
}

export async function setUserActive(userId: string, active: boolean): Promise<boolean> {
  if (!(await hasUserActiveColumn())) return false;
  const result = await prisma.$executeRawUnsafe(
    `UPDATE "User" SET active = $1, "updatedAt" = CURRENT_TIMESTAMP WHERE id = $2`,
    active,
    userId
  );
  return typeof result === "number" ? result > 0 : true;
}

export async function getUserActiveMap(userIds: string[]): Promise<Map<string, boolean>> {
  const map = new Map<string, boolean>();
  if (userIds.length === 0) return map;
  if (!(await hasUserActiveColumn())) {
    for (const id of userIds) map.set(id, true);
    return map;
  }
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; active: boolean }>>(
    `SELECT id, active FROM "User" WHERE id = ANY($1::text[])`,
    userIds
  );
  for (const row of rows) map.set(row.id, row.active);
  for (const id of userIds) {
    if (!map.has(id)) map.set(id, true);
  }
  return map;
}

/** Test helper — reset memoized probes. */
export function resetSchemaCapabilityCache(): void {
  userActiveColumn = null;
  userActiveCheckedAt = 0;
  adminTables = null;
  adminTablesCheckedAt = 0;
}
