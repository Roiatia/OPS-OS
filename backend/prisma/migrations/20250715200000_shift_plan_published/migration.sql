-- Publish gate: schedule is visible to staff only after OPS saves/publishes
ALTER TABLE "ShiftPlan" ADD COLUMN IF NOT EXISTS "publishedAt" TIMESTAMP(3);
