-- CreateEnum
CREATE TYPE "ScheduleTaskKind" AS ENUM ('MAP', 'HAPPY_HOUR', 'COMPANY_MEETING');

-- AlterTable
ALTER TABLE "Map" ADD COLUMN "taskKind" "ScheduleTaskKind" NOT NULL DEFAULT 'MAP';
