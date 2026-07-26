-- Hard cap on shift-plan days per week (e.g. Millie = 3)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "maxShiftsPerWeek" INTEGER;

-- Daily hub session CSV fields
ALTER TABLE "Map" ADD COLUMN IF NOT EXISTS "meetLink" TEXT;
ALTER TABLE "Map" ADD COLUMN IF NOT EXISTS "isNewStore" BOOLEAN NOT NULL DEFAULT false;
