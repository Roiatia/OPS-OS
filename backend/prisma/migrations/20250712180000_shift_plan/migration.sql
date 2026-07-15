-- OPS shift plan per week (supervisor + SL assignments)
CREATE TABLE IF NOT EXISTS "ShiftPlan" (
  "id" TEXT NOT NULL,
  "weekStart" DATE NOT NULL,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShiftPlan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ShiftPlan_weekStart_key" ON "ShiftPlan"("weekStart");
CREATE INDEX IF NOT EXISTS "ShiftPlan_weekStart_idx" ON "ShiftPlan"("weekStart");

CREATE TABLE IF NOT EXISTS "ShiftPlanAssignment" (
  "id" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "dayOfWeek" INTEGER NOT NULL,
  "userId" TEXT NOT NULL,
  CONSTRAINT "ShiftPlanAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ShiftPlanAssignment_planId_dayOfWeek_userId_key"
  ON "ShiftPlanAssignment"("planId", "dayOfWeek", "userId");
CREATE INDEX IF NOT EXISTS "ShiftPlanAssignment_planId_idx" ON "ShiftPlanAssignment"("planId");
CREATE INDEX IF NOT EXISTS "ShiftPlanAssignment_userId_idx" ON "ShiftPlanAssignment"("userId");

DO $$ BEGIN
  ALTER TABLE "ShiftPlan"
    ADD CONSTRAINT "ShiftPlan_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ShiftPlanAssignment"
    ADD CONSTRAINT "ShiftPlanAssignment_planId_fkey"
    FOREIGN KEY ("planId") REFERENCES "ShiftPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ShiftPlanAssignment"
    ADD CONSTRAINT "ShiftPlanAssignment_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
