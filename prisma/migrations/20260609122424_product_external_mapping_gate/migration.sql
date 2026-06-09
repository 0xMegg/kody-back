-- CreateEnum
CREATE TYPE "SourceSystem" AS ENUM ('IMWEB_KR', 'SHOPIFY', 'CAFE24', 'MANUAL');

-- CreateEnum
CREATE TYPE "MappingStatus" AS ENUM ('ACTIVE', 'ORPHANED', 'CONFLICTING');

-- CreateEnum
CREATE TYPE "ProductSaleStatus" AS ENUM ('ON_SALE', 'OFF_SALE', 'SOLD_OUT', 'DRAFT');

-- CreateEnum
CREATE TYPE "CategoryReviewStatus" AS ENUM ('PENDING', 'MAPPED', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "ImportBatchStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ImportRowOutcome" AS ENUM ('PENDING', 'CREATED', 'UPDATED', 'UNCHANGED', 'SKIPPED', 'NEEDS_REVIEW', 'FAILED');

-- DropForeignKey
ALTER TABLE "Product" DROP CONSTRAINT "Product_artistId_fkey";

-- DropIndex
DROP INDEX "Product_barcode_key";

-- DropIndex
DROP INDEX "Product_sku_key";

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "categoryReviewStatus" "CategoryReviewStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "detailHtml" TEXT,
ADD COLUMN     "isDisplayed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "labelName" TEXT,
ADD COLUMN     "releaseDate" TIMESTAMP(3),
ADD COLUMN     "releaseDateText" TEXT,
ADD COLUMN     "saleStatus" "ProductSaleStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "sourceCategoryCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "stockManaged" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "thumbnailUrl" TEXT,
ALTER COLUMN "artistId" DROP NOT NULL,
ALTER COLUMN "category" DROP NOT NULL,
ALTER COLUMN "weightG" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ProductExternalMapping" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sourceSystem" "SourceSystem" NOT NULL,
    "externalProductId" TEXT NOT NULL,
    "externalUrl" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceUpdatedAt" TIMESTAMP(3),
    "firstImportBatchId" TEXT,
    "lastImportBatchId" TEXT,
    "lastRawHash" TEXT,
    "status" "MappingStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "ProductExternalMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductSequence" (
    "key" TEXT NOT NULL,
    "lastSeq" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductSequence_pkey" PRIMARY KEY ("key")
);

-- SeedData
INSERT INTO "ProductSequence" ("key", "lastSeq") VALUES ('KODY-PROD', 0) ON CONFLICT DO NOTHING;

-- CreateTable
CREATE TABLE "ProductOption" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductOptionValue" (
    "id" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "priceDeltaKRW" INTEGER NOT NULL DEFAULT 0,
    "stockSnapshot" INTEGER,

    CONSTRAINT "ProductOptionValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "sourceSystem" "SourceSystem" NOT NULL,
    "sourceFileName" TEXT,
    "sourceFileHash" TEXT,
    "status" "ImportBatchStatus" NOT NULL DEFAULT 'PENDING',
    "isDryRun" BOOLEAN NOT NULL DEFAULT true,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "createdRows" INTEGER NOT NULL DEFAULT 0,
    "updatedRows" INTEGER NOT NULL DEFAULT 0,
    "unchangedRows" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "needsReviewRows" INTEGER NOT NULL DEFAULT 0,
    "triggeredBy" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRow" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "sourceSystem" "SourceSystem" NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "externalProductId" TEXT NOT NULL,
    "rawHash" TEXT NOT NULL,
    "rawPayload" JSONB NOT NULL,
    "outcome" "ImportRowOutcome" NOT NULL DEFAULT 'PENDING',
    "productId" TEXT,
    "mappingId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductExternalMapping_productId_idx" ON "ProductExternalMapping"("productId");

-- CreateIndex
CREATE INDEX "ProductExternalMapping_sourceSystem_lastSyncedAt_idx" ON "ProductExternalMapping"("sourceSystem", "lastSyncedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProductExternalMapping_sourceSystem_externalProductId_key" ON "ProductExternalMapping"("sourceSystem", "externalProductId");

-- CreateIndex
CREATE INDEX "ProductOption_productId_idx" ON "ProductOption"("productId");

-- CreateIndex
CREATE INDEX "ProductOptionValue_optionId_idx" ON "ProductOptionValue"("optionId");

-- CreateIndex
CREATE INDEX "ImportBatch_sourceSystem_startedAt_idx" ON "ImportBatch"("sourceSystem", "startedAt");

-- CreateIndex
CREATE INDEX "ImportRow_sourceSystem_externalProductId_rawHash_idx" ON "ImportRow"("sourceSystem", "externalProductId", "rawHash");

-- CreateIndex
CREATE INDEX "ImportRow_outcome_idx" ON "ImportRow"("outcome");

-- CreateIndex
CREATE UNIQUE INDEX "ImportRow_batchId_rowIndex_key" ON "ImportRow"("batchId", "rowIndex");

-- CreateIndex
CREATE UNIQUE INDEX "ImportRow_batchId_externalProductId_key" ON "ImportRow"("batchId", "externalProductId");

-- CreateIndex
CREATE INDEX "Product_category_idx" ON "Product"("category");

-- CreateIndex
CREATE INDEX "Product_sku_idx" ON "Product"("sku");

-- CreateIndex
CREATE INDEX "Product_barcode_idx" ON "Product"("barcode");

-- CreateIndex
CREATE INDEX "Product_saleStatus_idx" ON "Product"("saleStatus");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductExternalMapping" ADD CONSTRAINT "ProductExternalMapping_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductOption" ADD CONSTRAINT "ProductOption_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductOptionValue" ADD CONSTRAINT "ProductOptionValue_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "ProductOption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
