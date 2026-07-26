import { prisma } from "../lib/prisma.js";

/**
 * Repair incomplete Prisma enum swaps that leave columns on "RoleName_new"
 * while the client still casts filters as "RoleName". That mismatch breaks Hub
 * with: operator does not exist: "RoleName_new" = "RoleName".
 *
 * Idempotent: no-op when RoleName_new is absent.
 */
export async function fixRoleNameEnumMismatch(): Promise<boolean> {
  const stray = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM pg_type WHERE typname = 'RoleName_new'
    ) AS exists
  `;
  if (!stray[0]?.exists) return false;

  console.warn(
    "[db] Detected stray RoleName_new enum — repairing role columns onto RoleName"
  );

  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'UserRole'
          AND column_name = 'role' AND udt_name = 'RoleName_new'
      ) THEN
        ALTER TABLE "UserRole" ALTER COLUMN "role" TYPE text USING ("role"::text);
        UPDATE "UserRole" SET role = 'OPS_ADMIN' WHERE role = 'SUPER_ADMIN';
        DELETE FROM "UserRole" a USING "UserRole" b
          WHERE a.ctid < b.ctid AND a."userId" = b."userId" AND a.role = b.role;
        ALTER TABLE "UserRole" ALTER COLUMN "role" TYPE "RoleName" USING ("role"::"RoleName");
      END IF;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'RolePermission'
          AND column_name = 'role' AND udt_name = 'RoleName_new'
      ) THEN
        ALTER TABLE "RolePermission" ALTER COLUMN "role" TYPE text USING ("role"::text);
        DELETE FROM "RolePermission" WHERE role = 'SUPER_ADMIN';
        ALTER TABLE "RolePermission" ALTER COLUMN "role" TYPE "RoleName" USING ("role"::"RoleName");
      END IF;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'FeatureFlag'
          AND column_name = 'rolloutRoles' AND udt_name = '_RoleName_new'
      ) THEN
        ALTER TABLE "FeatureFlag" ALTER COLUMN "rolloutRoles" DROP DEFAULT;
        ALTER TABLE "FeatureFlag" ALTER COLUMN "rolloutRoles" TYPE text[] USING ("rolloutRoles"::text[]);
        UPDATE "FeatureFlag"
          SET "rolloutRoles" = array_remove("rolloutRoles", 'SUPER_ADMIN')
          WHERE 'SUPER_ADMIN' = ANY ("rolloutRoles");
        ALTER TABLE "FeatureFlag" ALTER COLUMN "rolloutRoles" TYPE "RoleName"[] USING ("rolloutRoles"::"RoleName"[]);
        ALTER TABLE "FeatureFlag" ALTER COLUMN "rolloutRoles" SET DEFAULT ARRAY[]::"RoleName"[];
      END IF;

      DROP CAST IF EXISTS ("RoleName_new" AS "RoleName");
      DROP CAST IF EXISTS ("RoleName" AS "RoleName_new");
      DROP FUNCTION IF EXISTS public.rolename_new_to_rolename("RoleName_new");
      DROP FUNCTION IF EXISTS public.rolename_to_rolename_new("RoleName");
      DROP TYPE IF EXISTS "RoleName_new";
    END $$;
  `);

  console.warn("[db] RoleName enum repair complete");
  return true;
}
