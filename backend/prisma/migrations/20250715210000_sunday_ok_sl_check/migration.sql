-- Sunday availability independent of Friday form
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "sundayOk" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "AvailabilitySubmission" ADD COLUMN IF NOT EXISTS "sundayOk" BOOLEAN NOT NULL DEFAULT true;

-- Shift-leader check request on Map
DO $$ BEGIN
  CREATE TYPE "SlCheckStatus" AS ENUM ('OPEN', 'CLAIMED', 'ACCEPTED', 'NEEDS_CORRECTIONS');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Map" ADD COLUMN IF NOT EXISTS "slCheckStatus" "SlCheckStatus";
ALTER TABLE "Map" ADD COLUMN IF NOT EXISTS "slCheckRequestedAt" TIMESTAMP(3);
ALTER TABLE "Map" ADD COLUMN IF NOT EXISTS "slCheckClaimedAt" TIMESTAMP(3);
ALTER TABLE "Map" ADD COLUMN IF NOT EXISTS "slCheckNote" TEXT;
ALTER TABLE "Map" ADD COLUMN IF NOT EXISTS "slCheckRequestedById" TEXT;
ALTER TABLE "Map" ADD COLUMN IF NOT EXISTS "slCheckClaimedById" TEXT;

DO $$ BEGIN
  ALTER TABLE "Map" ADD CONSTRAINT "Map_slCheckRequestedById_fkey"
    FOREIGN KEY ("slCheckRequestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Map" ADD CONSTRAINT "Map_slCheckClaimedById_fkey"
    FOREIGN KEY ("slCheckClaimedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "Map_slCheckStatus_idx" ON "Map"("slCheckStatus");
