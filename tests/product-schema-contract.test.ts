import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const schema = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8');
const migrationSql = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20260609122424_product_external_mapping_gate/migration.sql',
  ),
  'utf8',
);
const taxonomyMigrationSql = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20260623184700_product_taxonomy_g4c/migration.sql',
  ),
  'utf8',
);
const categoryProjectionMigrationSql = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20260629024500_product_category_projection_g2b/migration.sql',
  ),
  'utf8',
);

function modelBlock(name: string): string {
  const match = schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`));
  if (!match) throw new Error(`Missing model ${name}`);
  return match[0];
}

describe('Product schema contract', () => {
  it('keeps Product canonical and moves external source identity to ProductExternalMapping', () => {
    const product = modelBlock('Product');
    const mapping = modelBlock('ProductExternalMapping');

    expect(product).not.toContain('sourceSystem');
    expect(product).not.toContain('externalProductId');
    expect(product).toMatch(/^\s+externalMappings\s+ProductExternalMapping\[\]/m);

    expect(mapping).toContain('sourceSystem      SourceSystem');
    expect(mapping).toContain('externalProductId String');
    expect(mapping).toContain('@@unique([sourceSystem, externalProductId])');
  });

  it('does not treat SKU or barcode as unique product identities', () => {
    const product = modelBlock('Product');

    expect(product).toContain('sku');
    expect(product).toContain('barcode');
    expect(product).not.toMatch(/sku\s+String\?\s+@unique/);
    expect(product).not.toMatch(/barcode\s+String\?\s+@unique/);
    expect(product).toContain('@@index([sku])');
    expect(product).toContain('@@index([barcode])');
  });

  it('keeps the approved Imweb default-bundle Product fields nullable and source-preserving', () => {
    const product = modelBlock('Product');

    expect(product).toContain('artistId String?');
    expect(product).toContain(
      'artist   Artist? @relation(fields: [artistId], references: [id], onDelete: Restrict)',
    );
    expect(product).toMatch(/^\s+labelName\s+String\?/m);
    expect(product).toMatch(/^\s+thumbnailUrl\s+String\?/m);
    expect(product).toMatch(/^\s+detailHtml\s+String\?/m);
    expect(product).toMatch(/^\s+releaseDateText\s+String\?/m);
    expect(product).toMatch(/^\s+releaseDate\s+DateTime\?/m);
    expect(product).toMatch(/^\s+category\s+ProductCategory\?/m);
    expect(product).toMatch(/^\s+categoryMinor\s+ProductCategoryMinor\?/m);
    expect(product).toMatch(/^\s+itemType\s+ProductItemType\?/m);
    expect(product).toContain('sourceCategoryCodes   String[]              @default([])');
    expect(product).toContain('categoryMappingSource CategoryMappingSource @default(EXACT)');
    expect(product).toContain('categoryReviewStatus  CategoryReviewStatus  @default(PENDING)');
  });



  it('adds G4c taxonomy contract additively without migrating PHOTOCARD rows', () => {
    const product = modelBlock('Product');

    expect(schema).toContain('enum ProductCategory');
    expect(schema).toContain('PHOTOCARD');
    expect(schema).toContain('MAGAZINE');
    expect(schema).toContain('SEASON_GREETINGS');
    expect(schema).toContain('enum ProductCategoryMinor');
    expect(schema).toContain('BOY_GROUP');
    expect(schema).toContain('OFFICIAL_GOODS');
    expect(schema).toContain('enum ProductItemType');
    expect(schema).toContain('PHOTO_CARD');
    expect(product).toContain('categoryMinor         ProductCategoryMinor?');
    expect(product).toContain('itemType              ProductItemType?');
    expect(product).toContain('@@index([categoryMinor])');
    expect(product).toContain('@@index([itemType])');

    expect(taxonomyMigrationSql).toContain(`ALTER TYPE "ProductCategory" ADD VALUE IF NOT EXISTS 'MAGAZINE'`);
    expect(taxonomyMigrationSql).toContain('CREATE TYPE "ProductCategoryMinor" AS ENUM');
    expect(taxonomyMigrationSql).toContain('ALTER TABLE "Product" ADD COLUMN "categoryMinor" "ProductCategoryMinor"');
    expect(taxonomyMigrationSql).not.toContain('UPDATE "Product"');
    expect(taxonomyMigrationSql).not.toContain('DELETE FROM');
    expect(taxonomyMigrationSql).not.toContain('DROP VALUE');
  });

  it('adds G2b category projection storage additively without first-wins collapse', () => {
    const product = modelBlock('Product');

    expect(product).toMatch(/^\s+categoryArtist\s+String\?/m);
    expect(product).toMatch(/^\s+categoryArtistDetail\s+String\?/m);
    expect(product).toMatch(/^\s+categoryType\s+String\?/m);
    expect(product).toMatch(/^\s+categoryTypeDetail\s+String\?/m);
    expect(product).toMatch(/^\s+categoryArtistCandidates\s+String\[\]\s+@default\(\[\]\)/m);
    expect(product).toMatch(/^\s+categoryArtistDetailCandidates\s+String\[\]\s+@default\(\[\]\)/m);
    expect(product).toMatch(/^\s+categoryTypeCandidates\s+String\[\]\s+@default\(\[\]\)/m);
    expect(product).toMatch(/^\s+categoryTypeDetailCandidates\s+String\[\]\s+@default\(\[\]\)/m);
    expect(product).toMatch(/^\s+categoryProjectionMeta\s+Json\?/m);

    expect(product).toContain('@@index([categoryArtist])');
    expect(product).toContain('@@index([categoryArtistDetail])');
    expect(product).toContain('@@index([categoryType])');
    expect(product).toContain('@@index([categoryTypeDetail])');

    expect(product).toContain('category              ProductCategory?');
    expect(product).toContain('categoryMinor         ProductCategoryMinor?');
    expect(product).toContain('itemType              ProductItemType?');
    expect(product).toContain('sourceCategoryCodes   String[]              @default([])');

    expect(categoryProjectionMigrationSql).toContain('ALTER TABLE "Product" ADD COLUMN "categoryArtist" TEXT');
    expect(categoryProjectionMigrationSql).toContain('ALTER TABLE "Product" ADD COLUMN "categoryTypeDetailCandidates" TEXT[] DEFAULT ARRAY[]::TEXT[]');
    expect(categoryProjectionMigrationSql).toContain('ALTER TABLE "Product" ADD COLUMN "categoryProjectionMeta" JSONB');
    expect(categoryProjectionMigrationSql).toContain('CREATE INDEX "Product_categoryTypeDetail_idx"');
    expect(categoryProjectionMigrationSql).not.toMatch(/^\s*UPDATE\s+"Product"/m);
    expect(categoryProjectionMigrationSql).not.toMatch(/^\s*DELETE\s+FROM\s+"Product"/m);
    expect(categoryProjectionMigrationSql).not.toMatch(/^\s*DROP\s+/m);
  });

  it('adds approved import, option, and KODY product sequence models without variant stock semantics', () => {
    const option = modelBlock('ProductOption');
    const optionValue = modelBlock('ProductOptionValue');

    expect(() => modelBlock('ProductSequence')).not.toThrow();
    expect(option).toContain('product   Product @relation(fields: [productId], references: [id])');
    expect(optionValue).toContain('option   ProductOption @relation(fields: [optionId], references: [id])');
    expect(optionValue).toContain('priceDeltaKRW Int    @default(0)');
    expect(optionValue).toContain('stockSnapshot Int?');
    expect(optionValue).not.toContain('stockSnapshot Int @default');
    expect(optionValue).not.toContain('stockOnHand');
    expect(() => modelBlock('ImportBatch')).not.toThrow();
    expect(() => modelBlock('ImportRow')).not.toThrow();
  });

  // A-1a deliberately introduces ProductVariant. This block is the intentional
  // replacement for the prior "no ProductVariant" tripwire: it asserts the
  // additive shape AND keeps the no-variant-stock / no-relation-redirect guards.
  it('adds ProductVariant additively with absolute price and no stock semantics', () => {
    expect(schema).toContain('model ProductVariant');
    const variant = modelBlock('ProductVariant');
    const product = modelBlock('Product');

    expect(product).toMatch(/^\s+variants\s+ProductVariant\[\]/m);
    expect(variant).toContain(
      'product   Product @relation(fields: [productId], references: [id], onDelete: Cascade)',
    );
    expect(variant).toContain('name           String');
    expect(variant).toContain('optionValueIds String[] @default([])');
    expect(variant).toContain('sku            String?');
    expect(variant).toContain('barcode        String?');
    expect(variant).toContain('priceKRW Decimal @db.Decimal(15, 4)');
    expect(variant).toContain('saleStartAt DateTime?');
    expect(variant).toContain('saleEndAt   DateTime?');
    expect(variant).toContain('position  Int      @default(0)');
    expect(variant).toContain('@@index([productId])');

    // No variant stock authority in A-1.
    expect(variant).not.toContain('stockOnHand');
    expect(variant).not.toContain('stockManaged');
    expect(variant).not.toContain('stockSnapshot');
  });

  it('does not redirect order/shipment/stock relations away from Product or add variantId to ledgers', () => {
    const orderItem = modelBlock('OrderItem');
    const shipmentItem = modelBlock('ShipmentItem');
    const stockMovement = modelBlock('StockMovement');

    expect(orderItem).toMatch(/^\s+product\s+Product\s+@relation\(fields: \[productId\], references: \[id\]\)/m);
    expect(shipmentItem).toMatch(/^\s+product\s+Product\s+@relation\(fields: \[productId\], references: \[id\]\)/m);
    expect(stockMovement).toMatch(/^\s+product\s+Product\s+@relation\(fields: \[productId\], references: \[id\]\)/m);

    // A-1 keeps variant stock/ledger authority out of order/shipment/stock tables.
    expect(orderItem).not.toContain('variantId');
    expect(shipmentItem).not.toContain('variantId');
    expect(stockMovement).not.toContain('variantId');
  });

  it('keeps Imweb price-review state explicit and queryable without making price nullable', () => {
    const product = modelBlock('Product');
    const importRow = modelBlock('ImportRow');

    expect(schema).toContain('enum ProductPriceStatus');
    expect(product).toContain('priceKRW Decimal @db.Decimal(15, 4)');
    expect(product).toContain('priceStatus           ProductPriceStatus @default(CONFIRMED)');
    expect(product).toContain('lastConfirmedPriceKRW Decimal?           @db.Decimal(15, 4)');
    expect(product).toContain('sourcePriceRaw        String?');
    expect(product).toContain('@@index([priceStatus])');
    expect(importRow).toContain('sourcePriceRaw      String?');
    expect(importRow).toContain('parsedPriceKRW      Decimal?');
    expect(importRow).toContain('assignedPriceStatus ProductPriceStatus?');
    expect(importRow).toContain('priceReviewReason   String?');
  });



  it('persists external-source warning evidence without making warnings hard product identities', () => {
    const product = modelBlock('Product');
    const importRow = modelBlock('ImportRow');

    expect(schema).toContain('enum CategoryMappingSource');
    expect(product).toContain('categoryMappingSource CategoryMappingSource @default(EXACT)');
    expect(product).toContain('@@index([categoryMappingSource])');

    expect(importRow).toContain('warnings       Json?');
    expect(importRow).toContain('warningCodes   String[] @default([])');
    expect(importRow).toContain('reviewRequired Boolean  @default(false)');
    expect(importRow).toContain('@@index([warningCodes], type: Gin)');
  });

  it('keeps Imweb import audit models as dry-run-first evidence without write-route schema pressure', () => {
    const importBatch = modelBlock('ImportBatch');
    const importRow = modelBlock('ImportRow');

    expect(schema).toContain('enum SourceSystem');
    expect(schema).toContain('IMWEB_KR');
    expect(schema).toContain('enum ImportBatchStatus');
    expect(schema).toContain('enum ImportRowOutcome');
    expect(importBatch).toContain('sourceSystem   SourceSystem');
    expect(importBatch).toContain('status   ImportBatchStatus @default(PENDING)');
    expect(importBatch).toContain('isDryRun Boolean           @default(true)');
    expect(importBatch).toContain('needsReviewRows Int @default(0)');
    expect(importBatch).toContain('@@index([sourceSystem, startedAt])');

    expect(importRow).toContain('sourceSystem SourceSystem');
    expect(importRow).toContain('outcome ImportRowOutcome @default(PENDING)');
    expect(importRow).toContain('@@unique([batchId, rowIndex])');
    expect(importRow).toContain('@@unique([batchId, externalProductId])');
    expect(importRow).toContain('@@index([sourceSystem, externalProductId, rawHash])');
  });

  it('preserves existing Product relation behavior and stock counter invariants in the migration', () => {
    const product = modelBlock('Product');

    expect(product).toContain('stockOnHand  Int     @default(0)');
    expect(product).toContain(
      'artist   Artist? @relation(fields: [artistId], references: [id], onDelete: Restrict)',
    );
    expect(migrationSql).not.toContain('ALTER COLUMN "stockOnHand" DROP NOT NULL');
    expect(migrationSql).not.toContain('ALTER COLUMN "stockOnHand" DROP DEFAULT');
    expect(migrationSql).not.toContain('ON DELETE SET NULL');
    expect(migrationSql).toContain('ON DELETE RESTRICT');
  });
});
