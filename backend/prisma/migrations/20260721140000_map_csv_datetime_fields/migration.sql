-- Typed date columns for CSV Schedule / Mapping / Activation / studio fields.
-- Raw string columns remain for unparseable values (e.g. "done").

ALTER TABLE "Map" ADD COLUMN IF NOT EXISTS "scheduleAt" TIMESTAMP(3);
ALTER TABLE "Map" ADD COLUMN IF NOT EXISTS "mappingAt" TIMESTAMP(3);
ALTER TABLE "Map" ADD COLUMN IF NOT EXISTS "sentToStudioAt" TIMESTAMP(3);
ALTER TABLE "Map" ADD COLUMN IF NOT EXISTS "receivedFromStudioAt" TIMESTAMP(3);
ALTER TABLE "Map" ADD COLUMN IF NOT EXISTS "activationAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Map_mappingAt_idx" ON "Map"("mappingAt");
CREATE INDEX IF NOT EXISTS "Map_fieldDate_idx" ON "Map"("fieldDate");
