-- CreateTable
CREATE TABLE "ZillowImportRun" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "leadsFound" INTEGER NOT NULL DEFAULT 0,
    "leadsNew" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "rawJsonPath" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ZillowImportRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZillowLead" (
    "id" TEXT NOT NULL,
    "phone" TEXT,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "email" TEXT,
    "propertyText" TEXT NOT NULL,
    "propertyId" TEXT,
    "firstContactAt" TIMESTAMP(3),
    "zillowStatus" TEXT,
    "lastMessage" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "inviteId" TEXT,
    "sendError" TEXT,
    "importRunId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ZillowLead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ZillowImportRun_startedAt_idx" ON "ZillowImportRun"("startedAt");

-- CreateIndex
CREATE INDEX "ZillowLead_status_idx" ON "ZillowLead"("status");

-- CreateIndex
CREATE INDEX "ZillowLead_firstContactAt_idx" ON "ZillowLead"("firstContactAt");

-- CreateIndex
CREATE UNIQUE INDEX "ZillowLead_phone_propertyId_key" ON "ZillowLead"("phone", "propertyId");

-- AddForeignKey
ALTER TABLE "ZillowLead" ADD CONSTRAINT "ZillowLead_importRunId_fkey" FOREIGN KEY ("importRunId") REFERENCES "ZillowImportRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
