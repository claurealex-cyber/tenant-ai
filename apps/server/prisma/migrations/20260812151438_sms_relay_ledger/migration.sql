-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "forwardedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "OutboundRelayMessage" (
    "id" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "inviteId" TEXT,
    "applicationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "OutboundRelayMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessedWebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OutboundRelayMessage_status_createdAt_idx" ON "OutboundRelayMessage"("status", "createdAt");

-- CreateIndex
CREATE INDEX "OutboundRelayMessage_to_kind_status_sentAt_idx" ON "OutboundRelayMessage"("to", "kind", "status", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessedWebhookEvent_provider_messageId_key" ON "ProcessedWebhookEvent"("provider", "messageId");

-- Partial unique index: at most one outstanding (unused) invite per phone+property.
-- DB-level backstop against double-minting under webhook-retry races.
CREATE UNIQUE INDEX "SurveyInvite_phone_propertyId_outstanding_key"
  ON "SurveyInvite" ("phone", "propertyId") WHERE "usedAt" IS NULL;
