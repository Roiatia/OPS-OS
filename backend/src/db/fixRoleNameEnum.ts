import { prisma } from "../lib/prisma.js";

/**
 * Align role columns with Prisma's RoleName @@map("RoleName_new").
 *
 * Cloud SQL: postgres owns legacy "RoleName" (no SUPER_ADMIN; ops_dev cannot
 * ALTER it). SUPER_ADMIN lives on ops_dev-owned "RoleName_new". Columns must
 * use RoleName_new or Prisma casts fail and Super Admin cannot be stored.
 *
 * Older heal logic moved columns *back* to RoleName and remapped SUPER_ADMIN →
 * OPS_ADMIN — that undoes the Super Admin migration. This heal goes the other
 * way and is idempotent when already aligned.
 */
export async function fixRoleNameEnumMismatch(): Promise<boolean> {
  const cols = await prisma.$queryRaw<
    Array<{ table_name: string; column_name: string; udt_name: string }>
  >`
    SELECT table_name, column_name, udt_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (
        (table_name = 'UserRole' AND column_name = 'role')
        OR (table_name = 'RolePermission' AND column_name = 'role')
        OR (table_name = 'FeatureFlag' AND column_name = 'rolloutRoles')
      )
  `;

  const needsAlign = cols.some(
    (c) =>
      c.udt_name === "RoleName" ||
      c.udt_name === "_RoleName" ||
      (c.table_name === "UserRole" && c.udt_name !== "RoleName_new") ||
      (c.table_name === "RolePermission" && c.udt_name !== "RoleName_new") ||
      (c.table_name === "FeatureFlag" && c.udt_name !== "_RoleName_new")
  );

  let changed = false;

  if (needsAlign) {
    console.warn(
      "[db] Aligning role columns onto RoleName_new (preserves SUPER_ADMIN)"
    );

    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RoleName_new') THEN
          CREATE TYPE "RoleName_new" AS ENUM (
            'GRAPHIC_TEAM_LEADER',
            'MAPPING_INSPECTOR',
            'GRAPHIC_QA',
            'OPS_ADMIN',
            'SUPERVISOR',
            'SUPERVISOR_SHIFT_LEADER',
            'OPS_MANAGER_2',
            'OPS_MANAGER',
            'SUPER_ADMIN'
          );
        END IF;
      END $$;
    `);

    // ops_dev owns RoleName_new — safe even when the type already existed.
    await prisma.$executeRawUnsafe(
      `ALTER TYPE "RoleName_new" ADD VALUE IF NOT EXISTS 'SUPER_ADMIN'`
    );

    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'UserRole'
            AND column_name = 'role' AND udt_name = 'RoleName'
        ) THEN
          ALTER TABLE "UserRole"
            ALTER COLUMN "role" TYPE "RoleName_new"
            USING ("role"::text::"RoleName_new");
        END IF;

        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'RolePermission'
            AND column_name = 'role' AND udt_name = 'RoleName'
        ) THEN
          ALTER TABLE "RolePermission"
            ALTER COLUMN "role" TYPE "RoleName_new"
            USING ("role"::text::"RoleName_new");
        END IF;

        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'FeatureFlag'
            AND column_name = 'rolloutRoles' AND udt_name = '_RoleName'
        ) THEN
          ALTER TABLE "FeatureFlag" ALTER COLUMN "rolloutRoles" DROP DEFAULT;
          ALTER TABLE "FeatureFlag"
            ALTER COLUMN "rolloutRoles" TYPE "RoleName_new"[]
            USING ("rolloutRoles"::text::"RoleName_new"[]);
          ALTER TABLE "FeatureFlag"
            ALTER COLUMN "rolloutRoles" SET DEFAULT ARRAY[]::"RoleName_new"[];
        END IF;
      END $$;
    `);
    changed = true;
  }

  // Always restore demo Super Admin if a prior heal remapped them to OPS_ADMIN.
  // Must run after columns are on RoleName_new (or already were).
  const roleType = await prisma.$queryRaw<Array<{ udt_name: string }>>`
    SELECT udt_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'UserRole' AND column_name = 'role'
  `;
  if (roleType[0]?.udt_name === "RoleName_new") {
    const restored = await prisma.$executeRawUnsafe(`
      UPDATE "UserRole" ur
      SET role = 'SUPER_ADMIN'::"RoleName_new"
      FROM "User" u
      WHERE ur."userId" = u.id
        AND lower(u.email) = 'admin@ops-demo.local'
        AND ur.role::text = 'OPS_ADMIN'
    `);
    if (typeof restored === "number" && restored > 0) changed = true;
  }

  if (changed) {
    console.warn("[db] RoleName_new alignment complete");
  }
  return changed;
}
