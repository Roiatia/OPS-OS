-- CreateTable
CREATE TABLE "OpsDailyReport" (
    "id" TEXT NOT NULL,
    "reportDate" DATE NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpsDailyReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OpsDailyReport_reportDate_key" ON "OpsDailyReport"("reportDate");

-- CreateIndex
CREATE INDEX "OpsDailyReport_reportDate_idx" ON "OpsDailyReport"("reportDate" DESC);
