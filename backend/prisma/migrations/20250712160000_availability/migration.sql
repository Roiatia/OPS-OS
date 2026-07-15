-- Availability scheduling for supervisors / shift leaders
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "fridayContract" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "AvailabilitySubmission" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "weekStart" DATE NOT NULL,
  "fridayContract" BOOLEAN NOT NULL DEFAULT false,
  "note" TEXT,
  "submittedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AvailabilitySubmission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AvailabilityShift" (
  "id" TEXT NOT NULL,
  "submissionId" TEXT NOT NULL,
  "dayOfWeek" INTEGER NOT NULL,
  "startMinutes" INTEGER NOT NULL,
  "endMinutes" INTEGER NOT NULL,
  CONSTRAINT "AvailabilityShift_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AvailabilitySubmission_userId_weekStart_key"
  ON "AvailabilitySubmission"("userId", "weekStart");
CREATE INDEX IF NOT EXISTS "AvailabilitySubmission_weekStart_idx"
  ON "AvailabilitySubmission"("weekStart");
CREATE INDEX IF NOT EXISTS "AvailabilityShift_submissionId_idx"
  ON "AvailabilityShift"("submissionId");

DO $$ BEGIN
  ALTER TABLE "AvailabilitySubmission"
    ADD CONSTRAINT "AvailabilitySubmission_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AvailabilityShift"
    ADD CONSTRAINT "AvailabilityShift_submissionId_fkey"
    FOREIGN KEY ("submissionId") REFERENCES "AvailabilitySubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
