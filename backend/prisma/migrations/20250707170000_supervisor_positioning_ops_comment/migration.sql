-- Supervisor positioning flag and OPS manager comment
ALTER TABLE "Map" ADD COLUMN "positioning" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Map" ADD COLUMN "opsManagerComment" TEXT;
