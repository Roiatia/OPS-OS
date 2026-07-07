-- Add SUPERVISOR role and field-work assignment
ALTER TYPE "RoleName" ADD VALUE 'SUPERVISOR';

CREATE TYPE "SupervisorStatus" AS ENUM ('ACCEPTED', 'PROCESSING', 'DONE');

ALTER TABLE "Map" ADD COLUMN "supervisorStatus" "SupervisorStatus";
ALTER TABLE "Map" ADD COLUMN "assignedSupervisorId" TEXT;

ALTER TABLE "Map" ADD CONSTRAINT "Map_assignedSupervisorId_fkey"
  FOREIGN KEY ("assignedSupervisorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
