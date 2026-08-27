-- CreateTable
CREATE TABLE "ZillowAutoRun" (
    "id" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leadsFound" INTEGER NOT NULL DEFAULT 0,
    "leadsNew" INTEGER NOT NULL DEFAULT 0,
    "queuedSends" INTEGER NOT NULL DEFAULT 0,
    "sentImmediate" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "importRunId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ZillowAutoRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ZillowAutoRun_day_key" ON "ZillowAutoRun"("day");

-- CreateIndex
CREATE INDEX "ZillowAutoRun_day_idx" ON "ZillowAutoRun"("day");
