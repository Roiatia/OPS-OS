-- Day a map was loaded onto the Hub by the daily session CSV
ALTER TABLE "Map" ADD COLUMN IF NOT EXISTS "hubSessionAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Map_hubSessionAt_idx" ON "Map"("hubSessionAt");
