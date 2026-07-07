-- AlterTable
ALTER TABLE "Map" ADD COLUMN "dueDate" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MapNote" (
    "id" TEXT NOT NULL,
    "mapId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MapNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MapNote_mapId_createdAt_idx" ON "MapNote"("mapId", "createdAt");

-- AddForeignKey
ALTER TABLE "MapNote" ADD CONSTRAINT "MapNote_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "Map"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MapNote" ADD CONSTRAINT "MapNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
