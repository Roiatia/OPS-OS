-- Restore RoleName_new + SUPER_ADMIN after the destructive
-- 20260726113000_fix_rolename_enum_mismatch heal moved columns back onto
-- legacy RoleName and remapped SUPER_ADMIN → OPS_ADMIN.
--
-- Prisma RoleName is @@map("RoleName_new"); columns must match.

DO $$ BEGIN
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
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TYPE "RoleName_new" ADD VALUE IF NOT EXISTS 'SUPER_ADMIN';

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'UserRole'
      AND column_name = 'role' AND udt_name = 'RoleName'
  ) THEN
    ALTER TABLE "UserRole"
      ALTER COLUMN "role" TYPE "RoleName_new"
      USING ("role"::text::"RoleName_new");
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'RolePermission'
      AND column_name = 'role' AND udt_name = 'RoleName'
  ) THEN
    ALTER TABLE "RolePermission"
      ALTER COLUMN "role" TYPE "RoleName_new"
      USING ("role"::text::"RoleName_new");
  END IF;
END $$;

DO $$ BEGIN
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

-- Demo Super Admin remapped to OPS_ADMIN by the bad heal — restore.
UPDATE "UserRole" ur
SET role = 'SUPER_ADMIN'::"RoleName_new"
FROM "User" u
WHERE ur."userId" = u.id
  AND lower(u.email) = 'admin@ops-demo.local'
  AND ur.role::text = 'OPS_ADMIN';
