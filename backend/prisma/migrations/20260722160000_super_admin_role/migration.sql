-- SUPER_ADMIN role — all-access administrator.
--
-- Cloud SQL: type "RoleName" is owned by postgres, so
--   ALTER TYPE "RoleName" ADD VALUE ...
-- fails for ops_dev ("must be owner of type RoleName").
-- Privilege-safe approach: create a replacement enum owned by the current
-- user, move RoleName columns onto it, and leave the old unused type in place.
-- Prisma maps RoleName → RoleName_new via @@map in schema.prisma.

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

-- If RoleName_new already existed without SUPER_ADMIN, ops_dev can add it
-- (ops_dev owns RoleName_new).
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
