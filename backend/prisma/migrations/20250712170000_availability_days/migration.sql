-- Per-day availability with can/can't and optional note
CREATE TABLE IF NOT EXISTS "AvailabilityDay" (
  "id" TEXT NOT NULL,
  "submissionId" TEXT NOT NULL,
  "dayOfWeek" INTEGER NOT NULL,
  "canWork" BOOLEAN NOT NULL,
  "startMinutes" INTEGER,
  "endMinutes" INTEGER,
  "note" TEXT,
  CONSTRAINT "AvailabilityDay_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AvailabilityDay_submissionId_dayOfWeek_key"
  ON "AvailabilityDay"("submissionId", "dayOfWeek");
CREATE INDEX IF NOT EXISTS "AvailabilityDay_submissionId_idx"
  ON "AvailabilityDay"("submissionId");

DO $$ BEGIN
  ALTER TABLE "AvailabilityDay"
    ADD CONSTRAINT "AvailabilityDay_submissionId_fkey"
    FOREIGN KEY ("submissionId") REFERENCES "AvailabilitySubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

INSERT INTO "AvailabilityDay" ("id", "submissionId", "dayOfWeek", "canWork", "startMinutes", "endMinutes", "note")
SELECT
  'cmig' || substr(md5(s."submissionId" || ':' || s."dayOfWeek"::text), 1, 21),
  s."submissionId",
  s."dayOfWeek",
  true,
  s."startMinutes",
  s."endMinutes",
  NULL
FROM "AvailabilityShift" s;

DROP TABLE IF EXISTS "AvailabilityShift";
