-- Add explicit price-review state for Imweb products whose source price is missing or zero.
CREATE TYPE "ProductPriceStatus" AS ENUM ('CONFIRMED', 'MISSING', 'ZERO_NEEDS_REVIEW', 'STALE_NEEDS_RECONFIRM');

ALTER TABLE "Product"
  ADD COLUMN "priceStatus" "ProductPriceStatus" NOT NULL DEFAULT 'CONFIRMED',
  ADD COLUMN "lastConfirmedPriceKRW" DECIMAL(15,4),
  ADD COLUMN "lastConfirmedPriceAt" TIMESTAMP(3),
  ADD COLUMN "sourcePriceRaw" TEXT,
  ADD COLUMN "priceReviewNote" TEXT;

UPDATE "Product"
SET "lastConfirmedPriceKRW" = "priceKRW",
    "lastConfirmedPriceAt" = "updatedAt"
WHERE "priceStatus" = 'CONFIRMED';

CREATE INDEX "Product_priceStatus_idx" ON "Product"("priceStatus");

ALTER TABLE "ImportRow"
  ADD COLUMN "sourcePriceRaw" TEXT,
  ADD COLUMN "parsedPriceKRW" DECIMAL(15,4),
  ADD COLUMN "assignedPriceStatus" "ProductPriceStatus",
  ADD COLUMN "priceReviewReason" TEXT;
