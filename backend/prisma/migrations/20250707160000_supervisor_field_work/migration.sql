-- Supervisor field-work columns for on-site mapping
CREATE TYPE "FieldWorkStatus" AS ENUM ('UNCOMPLETED', 'COMPLETED', 'CANCELLED');

ALTER TABLE "Map" ADD COLUMN "fieldDate" TIMESTAMP(3);
ALTER TABLE "Map" ADD COLUMN "loomDone" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Map" ADD COLUMN "mapperName" TEXT;
ALTER TABLE "Map" ADD COLUMN "fieldWorkStatus" "FieldWorkStatus" NOT NULL DEFAULT 'UNCOMPLETED';
