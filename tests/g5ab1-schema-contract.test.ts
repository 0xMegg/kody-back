import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const schema = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8');

function modelBlock(name: string): string {
  const match = schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`));
  if (!match) throw new Error(`Missing model ${name}`);
  return match[0];
}

function enumBlock(name: string): string {
  const match = schema.match(new RegExp(`enum ${name} \\{[\\s\\S]*?\\n\\}`));
  if (!match) throw new Error(`Missing enum ${name}`);
  return match[0];
}

describe('G5-A/B-1 schema contract', () => {
  it('adds display and calendar lifecycle enums without Store/Tenant schema', () => {
    expect(enumBlock('DisplayLifecycleState')).toContain('DRAFT');
    expect(enumBlock('DisplayLifecycleState')).toContain('PUBLISHED');
    expect(enumBlock('DisplayLifecycleState')).toContain('ARCHIVED');
    expect(enumBlock('CalendarSourceType')).toContain('PRODUCT_SALE_WINDOW');
    expect(enumBlock('CalendarProjectionStatus')).toContain('CANCELLED');

    expect(schema).not.toContain('model Store');
    expect(schema).not.toContain('model Tenant');
    expect(schema).not.toMatch(/\bstoreId\b/);
    expect(schema).not.toMatch(/\btenantId\b/);
  });

  it('adds DisplayCollection and collection-local product ordering additively', () => {
    const product = modelBlock('Product');
    const collection = modelBlock('DisplayCollection');
    const placement = modelBlock('DisplayCollectionProduct');

    expect(product).toContain('displayCollectionProducts DisplayCollectionProduct[]');
    expect(collection).toContain('lifecycleState  DisplayLifecycleState @default(DRAFT)');
    expect(collection).toContain('createdByUserId String?');
    expect(collection).toContain('updatedByUserId String?');
    expect(collection).toContain('@@index([lifecycleState])');

    expect(placement).toContain('collectionId String');
    expect(placement).toContain('productId    String');
    expect(placement).toContain('sortPosition Int      @default(0)');
    expect(placement).toContain('isPinned     Boolean  @default(false)');
    expect(placement).toContain('@@unique([collectionId, productId])');
    expect(placement).toContain('@@index([collectionId, sortPosition])');
    expect(placement).toContain('@@index([productId])');
  });

  it('adds versioned homepage layout scaffold with layout-local collection ordering', () => {
    const layout = modelBlock('HomepageLayout');
    const placement = modelBlock('HomepageLayoutCollection');

    expect(layout).toContain('state                     DisplayLifecycleState @default(DRAFT)');
    expect(layout).toContain('version                   Int');
    expect(layout).toContain('snapshotHash              String?');
    expect(layout).toContain('publishedAt               DateTime?');
    expect(layout).toContain('publishedByUserId         String?');
    expect(layout).toContain('previousPublishedLayoutId String?');
    expect(layout).toContain('@@index([state])');

    expect(placement).toContain('layoutId     String');
    expect(placement).toContain('collectionId String');
    expect(placement).toContain('sortPosition Int      @default(0)');
    expect(placement).toContain('@@unique([layoutId, collectionId])');
    expect(placement).toContain('@@index([layoutId, sortPosition])');
  });

  it('adds calendar readiness projection without public adapter columns or product-level sale-window fields', () => {
    const product = modelBlock('Product');
    const projection = modelBlock('CalendarEventProjection');

    expect(projection).toContain('sourceType  CalendarSourceType');
    expect(projection).toContain('sourceId    String');
    expect(projection).toContain('startsAtUtc DateTime?');
    expect(projection).toContain('endsAtUtc   DateTime?');
    expect(projection).toContain('timezone    String                   @default("Asia/Seoul")');
    expect(projection).toContain('status      CalendarProjectionStatus @default(DRAFT)');
    expect(projection).toContain('@@unique([sourceType, sourceId])');
    expect(projection).toContain('@@index([status])');

    expect(projection).not.toContain('publicSyncState');
    expect(projection).not.toContain('adapterTarget');
    expect(product).not.toContain('saleStartAt');
    expect(product).not.toContain('saleEndAt');
  });
});
