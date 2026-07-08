-- Create unified map status enum
CREATE TYPE "MapStatus" AS ENUM ('ACCEPTED', 'PROCESSING', 'DONE', 'FIX', 'FIX_DONE', 'APPROVED');

ALTER TABLE "Map" ADD COLUMN "status" "MapStatus";

-- Merge inspector + QA columns into one value (QA statuses take priority)
UPDATE "Map" SET "status" = CASE
  WHEN "qaStatus" = 'FIX' THEN 'FIX'::"MapStatus"
  WHEN "qaStatus" = 'APPROVED' THEN 'APPROVED'::"MapStatus"
  WHEN "qaStatus" = 'FIX_DONE' THEN 'FIX_DONE'::"MapStatus"
  WHEN "inspectorStatus" = 'ACCEPTED' THEN 'ACCEPTED'::"MapStatus"
  WHEN "inspectorStatus" = 'PROCESSING' THEN 'PROCESSING'::"MapStatus"
  WHEN "inspectorStatus" = 'DONE' THEN 'DONE'::"MapStatus"
  ELSE NULL
END;

ALTER TABLE "Map" DROP COLUMN "inspectorStatus";
ALTER TABLE "Map" DROP COLUMN "qaStatus";

DROP TYPE "InspectorStatus";
DROP TYPE "QaStatus";
