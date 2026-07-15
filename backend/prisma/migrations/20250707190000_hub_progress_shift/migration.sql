-- AlterTable
ALTER TABLE "Map" ADD COLUMN "fieldProgressPercent" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Map" ADD COLUMN "onHubStatusBoard" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN "shiftStartedAt" TIMESTAMP(3);
