-- Zillow applicant signal (discovered in leadManagementTable.applicationInfo)
ALTER TABLE "ZillowLead" ADD COLUMN "applicationCompleted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ZillowLead" ADD COLUMN "applicationSent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ZillowLead" ADD COLUMN "coApplicants" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ZillowLead" ADD COLUMN "applicantSentBatchId" TEXT;
ALTER TABLE "ZillowLead" ADD COLUMN "applicantInvitedAt" TIMESTAMP(3);
CREATE INDEX "ZillowLead_applicationCompleted_idx" ON "ZillowLead"("applicationCompleted");
