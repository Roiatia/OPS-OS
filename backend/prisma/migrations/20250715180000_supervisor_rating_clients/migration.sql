-- Supervisor capacity profile for shift planning
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "supervisorRating" INTEGER;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "maxRequestedHours" INTEGER;

CREATE TABLE IF NOT EXISTS "SupervisorClientCapability" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "client" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupervisorClientCapability_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SupervisorClientCapability_userId_client_key" ON "SupervisorClientCapability"("userId", "client");
CREATE INDEX IF NOT EXISTS "SupervisorClientCapability_client_idx" ON "SupervisorClientCapability"("client");

DO $$ BEGIN
  ALTER TABLE "SupervisorClientCapability" ADD CONSTRAINT "SupervisorClientCapability_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
