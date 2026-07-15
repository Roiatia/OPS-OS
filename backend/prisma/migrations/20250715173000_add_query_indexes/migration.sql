-- Add indexes to speed up frequently filtered/sorted queries.
-- Naming follows Prisma default convention: <Table>_<col>_idx (composite: <Table>_<colA>_<colB>_idx).

-- CreateIndex
CREATE INDEX "Map_phase_idx" ON "Map"("phase");

-- CreateIndex
CREATE INDEX "Map_updatedAt_idx" ON "Map"("updatedAt");

-- CreateIndex
CREATE INDEX "Map_assignedInspectorId_idx" ON "Map"("assignedInspectorId");

-- CreateIndex
CREATE INDEX "Map_assignedQaId_idx" ON "Map"("assignedQaId");

-- CreateIndex
CREATE INDEX "Map_assignedSupervisorId_idx" ON "Map"("assignedSupervisorId");

-- CreateIndex
CREATE INDEX "Map_phase_fieldWorkStatus_idx" ON "Map"("phase", "fieldWorkStatus");

-- CreateIndex
CREATE INDEX "MapEvent_createdAt_idx" ON "MapEvent"("createdAt");

-- CreateIndex
CREATE INDEX "MapEvent_mapId_createdAt_idx" ON "MapEvent"("mapId", "createdAt");

-- CreateIndex
CREATE INDEX "Task_mapId_idx" ON "Task"("mapId");

-- CreateIndex
CREATE INDEX "Task_assignedToId_idx" ON "Task"("assignedToId");

-- CreateIndex
CREATE INDEX "MapAttachment_mapId_idx" ON "MapAttachment"("mapId");
