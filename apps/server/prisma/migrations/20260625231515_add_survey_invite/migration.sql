-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "intakeAutoReply" TEXT,
ADD COLUMN     "smsIntakeEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "SurveyInvite" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'sms',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "applicationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SurveyInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SurveyInvite_token_key" ON "SurveyInvite"("token");

-- CreateIndex
CREATE UNIQUE INDEX "SurveyInvite_applicationId_key" ON "SurveyInvite"("applicationId");

-- CreateIndex
CREATE INDEX "SurveyInvite_propertyId_createdAt_idx" ON "SurveyInvite"("propertyId", "createdAt");

-- CreateIndex
CREATE INDEX "SurveyInvite_phone_propertyId_idx" ON "SurveyInvite"("phone", "propertyId");

-- CreateIndex
CREATE INDEX "SurveyInvite_token_idx" ON "SurveyInvite"("token");

-- AddForeignKey
ALTER TABLE "SurveyInvite" ADD CONSTRAINT "SurveyInvite_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyInvite" ADD CONSTRAINT "SurveyInvite_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;
