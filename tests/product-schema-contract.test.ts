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
    expect(product).toContain('externalMappings ProductExternalMapping[]');

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

  it('adds approved import, option, and KODY product sequence models', () => {
    expect(() => modelBlock('ProductSequence')).not.toThrow();
    expect(() => modelBlock('ProductOption')).not.toThrow();
    expect(() => modelBlock('ProductOptionValue')).not.toThrow();
    expect(() => modelBlock('ImportBatch')).not.toThrow();
    expect(() => modelBlock('ImportRow')).not.toThrow();
  });

  it('does not introduce ProductVariant or redirect order/shipment/stock relations away from Product', () => {
    expect(schema).not.toContain('model ProductVariant');
    expect(modelBlock('OrderItem')).toContain('product       Product        @relation(fields: [productId], references: [id])');
    expect(modelBlock('ShipmentItem')).toContain('product   Product   @relation(fields: [productId], references: [id])');
    expect(modelBlock('StockMovement')).toContain('product   Product @relation(fields: [productId], references: [id])');
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
