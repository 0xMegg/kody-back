-- Warning persistence for external-source product imports.
-- Keeps imperfect Imweb rows importable while preserving row-level warning evidence.

CREATE TYPE "CategoryMappingSource" AS ENUM ('EXACT', 'FALLBACK', 'MANUAL');

ALTER TABLE "Product"
ADD COLUMN "categoryMappingSource" "CategoryMappingSource" NOT NULL DEFAULT 'EXACT';

ALTER TABLE "ImportRow"
ADD COLUMN "warnings" JSONB,
ADD COLUMN "warningCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "reviewRequired" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Product_categoryMappingSource_idx" ON "Product"("categoryMappingSource");
CREATE INDEX "ImportRow_warningCodes_idx" ON "ImportRow" USING GIN ("warningCodes");
