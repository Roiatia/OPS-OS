-- HISTORICAL / SUPERSEDED: this heal moved columns *off* RoleName_new and
-- remapped SUPER_ADMIN → OPS_ADMIN. That was correct only while Prisma cast
-- filters as "RoleName". Schema now @@map("RoleName_new"); see
-- 20260726140000_restore_rolename_new_super_admin and src/db/fixRoleNameEnum.ts.
--
-- Original intent: repair incomplete RoleName enum swap that left RoleName_new
-- behind while the client still cast filters as "RoleName"
-- (operator does not exist: "RoleName_new" = "RoleName").

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RoleName_new') THEN
    -- Move columns off RoleName_new via text so we can drop the stray type.
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'UserRole'
        AND column_name = 'role' AND udt_name = 'RoleName_new'
    ) THEN
      ALTER TABLE "UserRole" ALTER COLUMN "role" TYPE text USING ("role"::text);
      UPDATE "UserRole" SET role = 'OPS_ADMIN' WHERE role = 'SUPER_ADMIN';
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
    DROP TYPE "RoleName_new";
  END IF;
END $$;
