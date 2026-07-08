-- Upload stage must complete before mapping (field work)
ALTER TABLE "Map" ADD COLUMN "uploadCompletedAt" TIMESTAMP(3);

-- Backfill: maps already in field or past upload had upload approved
UPDATE "Map"
SET "uploadCompletedAt" = COALESCE("updatedAt", NOW())
WHERE "uploadApproved" = true AND "uploadCompletedAt" IS NULL;
