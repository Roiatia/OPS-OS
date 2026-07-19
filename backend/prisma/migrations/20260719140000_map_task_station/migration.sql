-- Independent board Task + Station (not derived from MapPhase).

CREATE TYPE "MapTask" AS ENUM ('UPLOAD', 'UPLOADED', 'POLISH');
CREATE TYPE "MapStation" AS ENUM ('OPS', 'GRAPHICS');

ALTER TABLE "Map" ADD COLUMN "task" "MapTask" NOT NULL DEFAULT 'UPLOAD';
ALTER TABLE "Map" ADD COLUMN "station" "MapStation" NOT NULL DEFAULT 'GRAPHICS';

-- One-time backfill from legacy phase-derived labels (no ongoing coupling).
UPDATE "Map" SET "task" = 'POLISH'
WHERE "phase" IN ('POLISH', 'QA_REVIEW', 'APPROVED');

UPDATE "Map" SET "station" = 'OPS'
WHERE "phase" = 'FIELD';

CREATE INDEX "Map_task_idx" ON "Map"("task");
CREATE INDEX "Map_station_idx" ON "Map"("station");
