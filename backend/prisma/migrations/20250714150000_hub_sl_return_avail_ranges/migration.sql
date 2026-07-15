-- Hub: SL approval tracking + dual availability ranges
ALTER TABLE "Map" ADD COLUMN IF NOT EXISTS "shiftLeaderApproved" BOOLEAN;
ALTER TABLE "Map" ADD COLUMN IF NOT EXISTS "returnVisitAt" TIMESTAMP(3);

ALTER TABLE "AvailabilityDay" ADD COLUMN IF NOT EXISTS "startMinutes2" INTEGER;
ALTER TABLE "AvailabilityDay" ADD COLUMN IF NOT EXISTS "endMinutes2" INTEGER;
