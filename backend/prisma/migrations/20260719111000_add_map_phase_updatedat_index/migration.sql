-- Composite index for the ordered active-list query
-- (WHERE phase [NOT] IN (...) ORDER BY "updatedAt" DESC), which dominates the
-- dashboard read at 200-1000+ maps.
-- Naming follows Prisma default convention: <Table>_<colA>_<colB>_idx.

-- CreateIndex
CREATE INDEX "Map_phase_updatedAt_idx" ON "Map"("phase", "updatedAt");
