import { describe, expect, it } from 'vitest';

import {
  DisplayPublicationService,
  type HomepageLayoutDraft,
  type StorefrontProductSummary,
} from '@/application/storefront/display-publication-service.js';

const service = new DisplayPublicationService();
const NOW = new Date('2026-07-01T00:00:00.000Z');
const STARTED = new Date('2026-06-30T00:00:00.000Z');
const ENDS_LATER = new Date('2026-07-02T00:00:00.000Z');

function publicWindow(overrides: Partial<StorefrontProductSummary> = {}): StorefrontProductSummary {
  return {
    id: 'product',
    saleStatus: 'ON_SALE',
    isDisplayed: true,
    publicSaleStartsAt: STARTED,
    publicSaleEndsAt: ENDS_LATER,
    publicSaleWindowStatus: 'APPROVED',
    ...overrides,
  };
}

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
            { sortPosition: 30, product: publicWindow({ id: 'draft', saleStatus: 'DRAFT' }) },
            { sortPosition: 10, product: publicWindow({ id: 'on_sale' }) },
            { sortPosition: 20, product: publicWindow({ id: 'sold_out', saleStatus: 'SOLD_OUT' }) },
            { sortPosition: 20, product: publicWindow({ id: 'same_position_a' }) },
            { sortPosition: 20, product: publicWindow({ id: 'same_position_b' }) },
            { sortPosition: 40, product: publicWindow({ id: 'hidden', isDisplayed: false }) },
            { sortPosition: 50, product: publicWindow({ id: 'off_sale', saleStatus: 'OFF_SALE' }) },
          ],
        },
      },
      {
        sortPosition: 10,
        collection: {
          id: 'collection_c',
          name: 'C',
          lifecycleState: 'PUBLISHED',
          products: [
            { sortPosition: 1, product: publicWindow({ id: 'c1' }) },
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
            { sortPosition: 1, product: publicWindow({ id: 'a1' }) },
          ],
        },
      },
    ],
  };
}

const projectionOptions = { now: NOW };

describe('DisplayPublicationService', () => {
  it('uses display, sale-status, and Product-level public sale-window eligibility for public projection', () => {
    expect(service.isPublicProductEligible(publicWindow({ id: 'p1', saleStatus: 'ON_SALE' }), NOW)).toBe(true);
    expect(service.isPublicProductEligible(publicWindow({ id: 'p2', saleStatus: 'SOLD_OUT' }), NOW)).toBe(true);
    expect(service.isPublicProductEligible(publicWindow({ id: 'p3', saleStatus: 'OFF_SALE' }), NOW)).toBe(false);
    expect(service.isPublicProductEligible(publicWindow({ id: 'p4', saleStatus: 'DRAFT' }), NOW)).toBe(false);
    expect(service.isPublicProductEligible(publicWindow({ id: 'p5', isDisplayed: false }), NOW)).toBe(false);
  });

  it('fails closed when Product-level public sale-window fields are missing or not approved', () => {
    expect(service.isPublicProductEligible({ id: 'missing', saleStatus: 'ON_SALE', isDisplayed: true }, NOW)).toBe(false);
    expect(service.isPublicProductEligible(publicWindow({ id: 'draft_window', publicSaleWindowStatus: 'DRAFT' }), NOW)).toBe(false);
    expect(service.isPublicProductEligible(publicWindow({ id: 'cancelled_window', publicSaleWindowStatus: 'CANCELLED' }), NOW)).toBe(false);
    expect(service.isPublicProductEligible(publicWindow({ id: 'missing_start', publicSaleStartsAt: null }), NOW)).toBe(false);
    expect(
      service.isPublicProductEligible(
        publicWindow({ id: 'bad_end', publicSaleStartsAt: NOW, publicSaleEndsAt: NOW }),
        NOW,
      ),
    ).toBe(false);
  });

  it('applies homepage time exposure gate with [start,end) boundaries using injected now', () => {
    expect(service.isPublicProductEligible(publicWindow({ id: 'start_equals_now', publicSaleStartsAt: NOW }), NOW)).toBe(true);
    expect(service.isPublicProductEligible(publicWindow({ id: 'future', publicSaleStartsAt: new Date('2026-07-01T00:00:01.000Z') }), NOW)).toBe(false);
    expect(service.isPublicProductEligible(publicWindow({ id: 'end_equals_now', publicSaleEndsAt: NOW }), NOW)).toBe(false);
    expect(service.isPublicProductEligible(publicWindow({ id: 'open_ended', publicSaleEndsAt: null }), NOW)).toBe(true);
  });

  it('keeps collection-local product ordering and layout-local collection ordering', () => {
    const projection = service.previewLayout(layoutFixture(), projectionOptions);

    expect(projection.isPublic).toBe(false);
    expect(projection.collections.map((collection) => collection.id)).toEqual([
      'collection_a',
      'collection_c',
      'collection_b',
    ]);
    expect(projection.collections[2]?.productIds).toEqual([
      'on_sale',
      'same_position_a',
      'same_position_b',
      'sold_out',
    ]);
  });

  it('does not project products from draft or archived collections', () => {
    const draftCollectionLayout = layoutFixture();
    draftCollectionLayout.collections[0]!.collection.lifecycleState = 'DRAFT';
    draftCollectionLayout.collections[1]!.collection.lifecycleState = 'ARCHIVED';

    const projection = service.previewLayout(draftCollectionLayout, projectionOptions);

    expect(projection.collections[0]?.productIds).toEqual(['a1']);
    expect(projection.collections[1]?.productIds).toEqual([]);
    expect(projection.collections[2]?.productIds).toEqual([]);
  });

  it('does not expose draft previews as public publication', () => {
    const draft = layoutFixture();

    expect(service.previewLayout(draft, projectionOptions).collections).toHaveLength(3);
    expect(service.publicProjection(draft, projectionOptions)).toEqual({
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

  it('does not read ProductVariant saleStartAt or saleEndAt for homepage projection', () => {
    const productWithVariantOnlyTrap = new Proxy(
      publicWindow({ id: 'variant_trap' }),
      {
        get(target, property, receiver) {
          if (property === 'saleStartAt' || property === 'saleEndAt') {
            throw new Error(`forbidden variant homepage read: ${String(property)}`);
          }
          return Reflect.get(target, property, receiver);
        },
      },
    );
    const layout: HomepageLayoutDraft = {
      id: 'layout_variant_trap',
      version: 1,
      state: 'PUBLISHED',
      collections: [
        {
          sortPosition: 1,
          collection: {
            id: 'collection_variant_trap',
            name: 'Variant trap',
            lifecycleState: 'PUBLISHED',
            products: [{ sortPosition: 1, product: productWithVariantOnlyTrap }],
          },
        },
      ],
    };

    expect(() => service.previewLayout(layout, projectionOptions)).not.toThrow();
    expect(service.publicProjection(layout, projectionOptions).collections[0]?.productIds).toEqual(['variant_trap']);
  });
});
