-- Align all RoleName columns with Prisma's @@map("RoleName_new").
--
-- Cloud SQL: postgres owns legacy "RoleName" (no SUPER_ADMIN; ops_dev cannot
-- ALTER TYPE it). Earlier migrations may have been marked applied without
-- actually creating RoleName_new / converting columns. FeatureFlag.rolloutRoles
-- was also created as RoleName[] under an older migration revision.
--
-- Prisma client emits RoleName_new / RoleName_new[] casts — columns must match.

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

-- Scalar role columns (legacy RoleName → RoleName_new)
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

-- FeatureFlag.rolloutRoles array (postgres array udt is _RoleName / _RoleName_new)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'FeatureFlag'
      AND column_name = 'rolloutRoles' AND udt_name = '_RoleName'
  ) THEN
    -- Drop legacy default first — PG will not auto-cast RoleName[] defaults.
    ALTER TABLE "FeatureFlag"
      ALTER COLUMN "rolloutRoles" DROP DEFAULT;
    -- Cast via text: RoleName[] → text → RoleName_new[] (no subquery in USING).
    ALTER TABLE "FeatureFlag"
      ALTER COLUMN "rolloutRoles" TYPE "RoleName_new"[]
      USING ("rolloutRoles"::text::"RoleName_new"[]);
    ALTER TABLE "FeatureFlag"
      ALTER COLUMN "rolloutRoles" SET DEFAULT ARRAY[]::"RoleName_new"[];
  END IF;
END $$;
