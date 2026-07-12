-- Repair drift: remote DB lost inspectorStatus/qaStatus after parallel migrations.
-- Prisma schema + hub/maps queries still expect these columns.

DO $$ BEGIN
  CREATE TYPE "InspectorStatus" AS ENUM ('ACCEPTED', 'PROCESSING', 'DONE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "QaStatus" AS ENUM ('FIX', 'FIX_DONE', 'APPROVED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Map" ADD COLUMN IF NOT EXISTS "inspectorStatus" "InspectorStatus";
ALTER TABLE "Map" ADD COLUMN IF NOT EXISTS "qaStatus" "QaStatus";
