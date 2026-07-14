-- CreateIndex
CREATE INDEX "Map_phase_idx" ON "Map"("phase");

-- CreateIndex
CREATE INDEX "Map_assignedInspectorId_idx" ON "Map"("assignedInspectorId");

-- CreateIndex
CREATE INDEX "Map_assignedQaId_idx" ON "Map"("assignedQaId");

-- CreateIndex
CREATE INDEX "Map_updatedAt_idx" ON "Map"("updatedAt");

-- CreateIndex
CREATE INDEX "Map_releasedToPipeline_idx" ON "Map"("releasedToPipeline");

-- CreateIndex
CREATE INDEX "MapAttachment_mapId_idx" ON "MapAttachment"("mapId");

-- CreateIndex
CREATE INDEX "Task_mapId_idx" ON "Task"("mapId");

-- CreateIndex
CREATE INDEX "MapEvent_mapId_idx" ON "MapEvent"("mapId");
