-- Admin permissions system: Permission enum + RolePermission + UserPermission (per-user overrides)
-- Written idempotently so it is safe to apply on a drifted / shared database.

DO $$ BEGIN
  CREATE TYPE "Permission" AS ENUM (
    'MAPS_VIEW',
    'MAPS_ASSIGN_INSPECTOR',
    'MAPS_ASSIGN_QA',
    'MAPS_INSPECTOR_STATUS',
    'MAPS_QA_REVIEW',
    'MAPS_UPLOAD_REVIEW',
    'MAPS_FIELD_UPDATE',
    'MAPS_HUB_VIEW',
    'MAPS_HUB_MANAGE',
    'MAPS_HISTORY',
    'MAPS_IMPORT_CSV',
    'MAPS_SYNC_SPREADSHEET',
    'TEAM_VIEW',
    'REPORTS_VIEW',
    'AVAILABILITY_VIEW',
    'AVAILABILITY_MANAGE',
    'SHIFT_PLAN_MANAGE',
    'USERS_MANAGE',
    'ROLES_MANAGE'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "RolePermission" (
  "id" TEXT NOT NULL,
  "role" "RoleName" NOT NULL,
  "permission" "Permission" NOT NULL,
  CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "UserPermission" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "permission" "Permission" NOT NULL,
  "granted" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "UserPermission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RolePermission_role_permission_key"
  ON "RolePermission"("role", "permission");
CREATE INDEX IF NOT EXISTS "RolePermission_role_idx"
  ON "RolePermission"("role");

CREATE UNIQUE INDEX IF NOT EXISTS "UserPermission_userId_permission_key"
  ON "UserPermission"("userId", "permission");
CREATE INDEX IF NOT EXISTS "UserPermission_userId_idx"
  ON "UserPermission"("userId");

DO $$ BEGIN
  ALTER TABLE "UserPermission"
    ADD CONSTRAINT "UserPermission_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
