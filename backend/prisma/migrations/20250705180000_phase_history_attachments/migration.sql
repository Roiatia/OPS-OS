-- AlterEnum
ALTER TYPE "MapPhase" ADD VALUE 'CANCELLED';

-- CreateTable
CREATE TABLE "MapPhaseHistory" (
    "id" TEXT NOT NULL,
    "mapId" TEXT NOT NULL,
    "phase" "MapPhase" NOT NULL,
    "userId" TEXT NOT NULL,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "MapPhaseHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MapAttachment" (
    "id" TEXT NOT NULL,
    "mapId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MapAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MapPhaseHistory_mapId_phase_idx" ON "MapPhaseHistory"("mapId", "phase");

-- AddForeignKey
ALTER TABLE "MapPhaseHistory" ADD CONSTRAINT "MapPhaseHistory_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "Map"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MapPhaseHistory" ADD CONSTRAINT "MapPhaseHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MapAttachment" ADD CONSTRAINT "MapAttachment_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "Map"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MapAttachment" ADD CONSTRAINT "MapAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
