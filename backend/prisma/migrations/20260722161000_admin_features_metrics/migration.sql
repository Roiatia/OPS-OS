-- Admin foundation: soft-disable users, feature flags (+ per-user overrides),
-- and self-contained product-usage events.

-- User soft-disable flag
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "active" BOOLEAN NOT NULL DEFAULT true;

-- Feature flags
CREATE TABLE IF NOT EXISTS "FeatureFlag" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "description" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "isExperimental" BOOLEAN NOT NULL DEFAULT false,
  "rolloutRoles" "RoleName_new"[] DEFAULT ARRAY[]::"RoleName_new"[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "FeatureFlag_key_key" ON "FeatureFlag"("key");

-- Per-user overrides
CREATE TABLE IF NOT EXISTS "FeatureFlagOverride" (
  "id" TEXT NOT NULL,
  "flagId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FeatureFlagOverride_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "FeatureFlagOverride_flagId_userId_key"
  ON "FeatureFlagOverride"("flagId", "userId");
CREATE INDEX IF NOT EXISTS "FeatureFlagOverride_userId_idx"
  ON "FeatureFlagOverride"("userId");

DO $$ BEGIN
  ALTER TABLE "FeatureFlagOverride"
    ADD CONSTRAINT "FeatureFlagOverride_flagId_fkey"
    FOREIGN KEY ("flagId") REFERENCES "FeatureFlag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "FeatureFlagOverride"
    ADD CONSTRAINT "FeatureFlagOverride_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Usage events
CREATE TABLE IF NOT EXISTS "UsageEvent" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "event" TEXT NOT NULL,
  "section" TEXT,
  "role" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UsageEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "UsageEvent_createdAt_idx" ON "UsageEvent"("createdAt");
CREATE INDEX IF NOT EXISTS "UsageEvent_event_idx" ON "UsageEvent"("event");
CREATE INDEX IF NOT EXISTS "UsageEvent_userId_idx" ON "UsageEvent"("userId");
CREATE INDEX IF NOT EXISTS "UsageEvent_event_createdAt_idx" ON "UsageEvent"("event", "createdAt");

DO $$ BEGIN
  ALTER TABLE "UsageEvent"
    ADD CONSTRAINT "UsageEvent_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
