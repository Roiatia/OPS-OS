-- Open swap offers (request, not instant transfer)
ALTER TABLE "Map" ADD COLUMN IF NOT EXISTS "swapBatchId" TEXT;
ALTER TABLE "Map" ADD COLUMN IF NOT EXISTS "swapOfferedAt" TIMESTAMP(3);
ALTER TABLE "Map" ADD COLUMN IF NOT EXISTS "swapOfferedById" TEXT;

DO $$ BEGIN
  ALTER TABLE "Map" ADD CONSTRAINT "Map_swapOfferedById_fkey"
    FOREIGN KEY ("swapOfferedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "Map_swapBatchId_idx" ON "Map"("swapBatchId");

CREATE TABLE IF NOT EXISTS "SwapOfferDecline" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SwapOfferDecline_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SwapOfferDecline_batchId_userId_key"
  ON "SwapOfferDecline"("batchId", "userId");

CREATE INDEX IF NOT EXISTS "SwapOfferDecline_batchId_idx" ON "SwapOfferDecline"("batchId");

DO $$ BEGIN
  ALTER TABLE "SwapOfferDecline" ADD CONSTRAINT "SwapOfferDecline_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
