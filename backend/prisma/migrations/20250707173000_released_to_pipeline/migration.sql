-- AlterTable
ALTER TABLE "Map" ADD COLUMN "releasedToPipeline" BOOLEAN NOT NULL DEFAULT false;

-- Existing non-intake maps are already in the pipeline view
UPDATE "Map" SET "releasedToPipeline" = true WHERE phase != 'INTAKE';
