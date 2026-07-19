DO $$ BEGIN
  CREATE TYPE "ShiftChangeStatus" AS ENUM (
    'PENDING_COUNTERPART',
    'PENDING_OPS',
    'ACCEPTED',
    'REJECTED',
    'CANCELLED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ShiftChangeRequest" (
  "id" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "weekStart" DATE NOT NULL,
  "dayOfWeek" INTEGER NOT NULL,
  "fromUserId" TEXT NOT NULL,
  "toUserId" TEXT NOT NULL,
  "status" "ShiftChangeStatus" NOT NULL DEFAULT 'PENDING_COUNTERPART',
  "note" TEXT,
  "counterpartAt" TIMESTAMP(3),
  "opsAt" TIMESTAMP(3),
  "opsById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ShiftChangeRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ShiftChangeRequest_planId_status_idx" ON "ShiftChangeRequest"("planId", "status");
CREATE INDEX IF NOT EXISTS "ShiftChangeRequest_fromUserId_status_idx" ON "ShiftChangeRequest"("fromUserId", "status");
CREATE INDEX IF NOT EXISTS "ShiftChangeRequest_toUserId_status_idx" ON "ShiftChangeRequest"("toUserId", "status");
CREATE INDEX IF NOT EXISTS "ShiftChangeRequest_weekStart_dayOfWeek_idx" ON "ShiftChangeRequest"("weekStart", "dayOfWeek");

DO $$ BEGIN
  ALTER TABLE "ShiftChangeRequest" ADD CONSTRAINT "ShiftChangeRequest_planId_fkey"
    FOREIGN KEY ("planId") REFERENCES "ShiftPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ShiftChangeRequest" ADD CONSTRAINT "ShiftChangeRequest_fromUserId_fkey"
    FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ShiftChangeRequest" ADD CONSTRAINT "ShiftChangeRequest_toUserId_fkey"
    FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ShiftChangeRequest" ADD CONSTRAINT "ShiftChangeRequest_opsById_fkey"
    FOREIGN KEY ("opsById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
