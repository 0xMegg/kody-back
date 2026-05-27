-- Add columns to Product table
ALTER TABLE "Product" ADD COLUMN "sku" TEXT;
ALTER TABLE "Product" ADD COLUMN "barcode" TEXT;
ALTER TABLE "Product" ADD COLUMN "avgPurchasePriceKRW" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN "orderBasedStock" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN "shipmentBasedStock" INTEGER NOT NULL DEFAULT 0;

-- Add unique constraints
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");
CREATE UNIQUE INDEX "Product_barcode_key" ON "Product"("barcode");

-- Add new ActionType enum values
ALTER TYPE "ActionType" ADD VALUE 'PRODUCT_CREATE';
ALTER TYPE "ActionType" ADD VALUE 'PRODUCT_UPDATE';
