-- Upload-stage CSV assignee names + conflict flag for Please assign UI.
ALTER TABLE "Map" ADD COLUMN IF NOT EXISTS "graphicsUploadAssignee" TEXT;
ALTER TABLE "Map" ADD COLUMN IF NOT EXISTS "uploadQaAssignee" TEXT;
ALTER TABLE "Map" ADD COLUMN IF NOT EXISTS "assigneeConflict" BOOLEAN NOT NULL DEFAULT false;
