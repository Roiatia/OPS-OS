-- CreateEnum
CREATE TYPE "WorkflowPhaseTarget" AS ENUM ('PRE_UPLOAD', 'UPLOADED', 'POLISH');

-- AlterTable
ALTER TABLE "Map" ADD COLUMN "workflowPhaseTarget" "WorkflowPhaseTarget" NOT NULL DEFAULT 'PRE_UPLOAD';
