import { describe, expect, it } from 'vitest';

import {
  DisplayPublicationService,
  type HomepageLayoutDraft,
} from '@/application/storefront/display-publication-service.js';

const service = new DisplayPublicationService();

function layoutFixture(): HomepageLayoutDraft {
  return {
    id: 'layout_draft',
    version: 3,
    state: 'DRAFT',
    snapshotHash: 'draft-hash',
    collections: [
      {
        sortPosition: 20,
        collection: {
          id: 'collection_b',
          name: 'B',
          lifecycleState: 'PUBLISHED',
          products: [
            { sortPosition: 30, product: { id: 'draft', saleStatus: 'DRAFT', isDisplayed: true } },
            { sortPosition: 10, product: { id: 'on_sale', saleStatus: 'ON_SALE', isDisplayed: true } },
            { sortPosition: 20, product: { id: 'sold_out', saleStatus: 'SOLD_OUT', isDisplayed: true } },
            { sortPosition: 40, product: { id: 'hidden', saleStatus: 'ON_SALE', isDisplayed: false } },
            { sortPosition: 50, product: { id: 'off_sale', saleStatus: 'OFF_SALE', isDisplayed: true } },
          ],
        },
      },
      {
        sortPosition: 10,
        collection: {
          id: 'collection_a',
          name: 'A',
          lifecycleState: 'PUBLISHED',
          products: [
            { sortPosition: 1, product: { id: 'a1', saleStatus: 'ON_SALE', isDisplayed: true } },
          ],
        },
      },
    ],
  };
}

describe('DisplayPublicationService', () => {
  it('uses product display and sale-status eligibility for public projection', () => {
    expect(service.isPublicProductEligible({ id: 'p1', saleStatus: 'ON_SALE', isDisplayed: true })).toBe(true);
    expect(service.isPublicProductEligible({ id: 'p2', saleStatus: 'SOLD_OUT', isDisplayed: true })).toBe(true);
    expect(service.isPublicProductEligible({ id: 'p3', saleStatus: 'OFF_SALE', isDisplayed: true })).toBe(false);
    expect(service.isPublicProductEligible({ id: 'p4', saleStatus: 'DRAFT', isDisplayed: true })).toBe(false);
    expect(service.isPublicProductEligible({ id: 'p5', saleStatus: 'ON_SALE', isDisplayed: false })).toBe(false);
  });

  it('keeps collection-local product ordering and layout-local collection ordering', () => {
    const projection = service.previewLayout(layoutFixture());

    expect(projection.isPublic).toBe(false);
    expect(projection.collections.map((collection) => collection.id)).toEqual(['collection_a', 'collection_b']);
    expect(projection.collections[1]?.productIds).toEqual(['on_sale', 'sold_out']);
  });

  it('does not project products from draft or archived collections', () => {
    const draftCollectionLayout = layoutFixture();
    draftCollectionLayout.collections[0]!.collection.lifecycleState = 'DRAFT';
    draftCollectionLayout.collections[1]!.collection.lifecycleState = 'ARCHIVED';

    const projection = service.previewLayout(draftCollectionLayout);

    expect(projection.collections[0]?.productIds).toEqual([]);
    expect(projection.collections[1]?.productIds).toEqual([]);
  });

  it('does not expose draft previews as public publication', () => {
    const draft = layoutFixture();

    expect(service.previewLayout(draft).collections).toHaveLength(2);
    expect(service.publicProjection(draft)).toEqual({
      layoutId: 'layout_draft',
      version: 3,
      state: 'DRAFT',
      isPublic: false,
      collections: [],
    });
  });

  it('publishes a homepage layout as a single changeset with auditable scaffold', () => {
    const now = new Date('2026-06-24T03:00:00.000Z');
    const currentPublishedLayout = { ...layoutFixture(), id: 'layout_current', state: 'PUBLISHED' as const, version: 2 };
    const result = service.publishLayout({
      draftLayout: layoutFixture(),
      currentPublishedLayout,
      actorUserId: 'user_manager',
      now,
    });

    expect(result.publishedLayout).toMatchObject({
      id: 'layout_draft',
      state: 'PUBLISHED',
      publishedAt: now,
      publishedByUserId: 'user_manager',
      previousPublishedLayoutId: 'layout_current',
    });
    expect(result.audit).toMatchObject({
      actorUserId: 'user_manager',
      action: 'HOMEPAGE_LAYOUT_PUBLISH',
      targetType: 'HomepageLayout',
      targetId: 'layout_draft',
      createdAt: now,
    });
    expect(result.audit.beforeJson).toMatchObject({ layoutId: 'layout_current', version: 2 });
    expect(result.audit.afterJson).toMatchObject({ layoutId: 'layout_draft', version: 3, state: 'PUBLISHED' });
  });

  it('rolls back to the immediate previous published layout with audit before/after payloads', () => {
    const now = new Date('2026-06-24T04:00:00.000Z');
    const previousPublishedLayout = { ...layoutFixture(), id: 'layout_previous', state: 'PUBLISHED' as const, version: 4 };
    const currentPublishedLayout = { ...layoutFixture(), id: 'layout_current', state: 'PUBLISHED' as const, version: 5 };

    const result = service.rollbackToPrevious({
      currentPublishedLayout,
      previousPublishedLayout,
      actorUserId: 'user_admin',
      now,
    });

    expect(result.restoredLayout).toMatchObject({
      id: 'layout_previous',
      state: 'PUBLISHED',
      version: 6,
      publishedAt: now,
      publishedByUserId: 'user_admin',
      previousPublishedLayoutId: 'layout_current',
    });
    expect(result.audit).toMatchObject({
      actorUserId: 'user_admin',
      action: 'HOMEPAGE_LAYOUT_ROLLBACK',
      targetType: 'HomepageLayout',
      targetId: 'layout_previous',
    });
    expect(result.audit.beforeJson).toMatchObject({ layoutId: 'layout_current', version: 5 });
    expect(result.audit.afterJson).toMatchObject({ layoutId: 'layout_previous', version: 6 });
  });
});
