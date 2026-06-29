-- G2b: additive product category projection storage.
-- File-only/manual SQL; no data backfill, importer write, or legacy category rewrite.

ALTER TABLE "Product" ADD COLUMN "categoryArtist" TEXT;
ALTER TABLE "Product" ADD COLUMN "categoryArtistDetail" TEXT;
ALTER TABLE "Product" ADD COLUMN "categoryType" TEXT;
ALTER TABLE "Product" ADD COLUMN "categoryTypeDetail" TEXT;
ALTER TABLE "Product" ADD COLUMN "categoryArtistCandidates" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Product" ADD COLUMN "categoryArtistDetailCandidates" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Product" ADD COLUMN "categoryTypeCandidates" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Product" ADD COLUMN "categoryTypeDetailCandidates" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Product" ADD COLUMN "categoryProjectionMeta" JSONB;

CREATE INDEX "Product_categoryArtist_idx" ON "Product"("categoryArtist");
CREATE INDEX "Product_categoryArtistDetail_idx" ON "Product"("categoryArtistDetail");
CREATE INDEX "Product_categoryType_idx" ON "Product"("categoryType");
CREATE INDEX "Product_categoryTypeDetail_idx" ON "Product"("categoryTypeDetail");
