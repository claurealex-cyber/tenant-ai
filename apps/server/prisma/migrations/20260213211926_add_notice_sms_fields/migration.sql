-- AlterTable
ALTER TABLE "Notice" ADD COLUMN     "smsSentAt" TIMESTAMP(3),
ADD COLUMN     "smsSid" TEXT,
ADD COLUMN     "smsTo" TEXT;
