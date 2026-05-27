-- Add depositorName to Payment
ALTER TABLE "Payment" ADD COLUMN "depositorName" TEXT;

-- Add new ActionType enum values
ALTER TYPE "ActionType" ADD VALUE 'PAYMENT_UPDATE';
ALTER TYPE "ActionType" ADD VALUE 'PAYMENT_DELETE';
