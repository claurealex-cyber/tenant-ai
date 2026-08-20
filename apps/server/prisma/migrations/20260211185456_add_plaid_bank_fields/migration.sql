-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "bankAccountLast4" TEXT,
ADD COLUMN     "bankName" TEXT,
ADD COLUMN     "plaidItemId" TEXT,
ADD COLUMN     "stripePaymentMethodId" TEXT;
