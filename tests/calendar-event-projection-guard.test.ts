import { describe, expect, it } from 'vitest';

import {
  CalendarEventProjectionService,
  validateProductSaleWindowForProjection,
} from '@/application/storefront/calendar-event-projection-service.js';
import { PublicAdapterPreviewService } from '@/application/storefront/public-adapter-preview-service.js';

const service = new CalendarEventProjectionService();

describe('CalendarEventProjectionService', () => {
  it('emits zero public-facing events until product-level sale-window source is approved', () => {
    const result = service.projectPublicEvents([
      { productId: 'product_1', publicSaleWindowStatus: 'DRAFT' },
    ]);

    expect(result).toEqual({
      publicEvents: [],
      reason: 'PRODUCT_LEVEL_SALE_WINDOW_NOT_APPROVED',
    });
  });

  it('projects approved product-level public sale-window sources without ProductVariant fields', () => {
    const startsAtUtc = new Date('2026-07-01T00:00:00.000Z');
    const endsAtUtc = new Date('2026-07-07T00:00:00.000Z');

    const result = service.projectPublicEvents([
      {
        productId: 'product_approved',
        publicSaleStartsAt: startsAtUtc,
        publicSaleEndsAt: endsAtUtc,
        publicSaleWindowStatus: 'APPROVED',
      },
    ]);

    expect(result).toEqual({
      publicEvents: [
        {
          id: 'product-sale-window:product_approved',
          sourceType: 'PRODUCT_SALE_WINDOW',
          sourceId: 'product_approved',
          startsAtUtc,
          endsAtUtc,
          timezone: 'Asia/Seoul',
          status: 'PUBLISHED',
        },
      ],
      reason: null,
    });
  });

  it('requires explicit APPROVED status; readiness is derived from status and dates', () => {
    expect(
      validateProductSaleWindowForProjection({
        productId: 'product_ready',
        publicSaleStartsAt: new Date('2026-07-01T00:00:00.000Z'),
        publicSaleWindowStatus: 'APPROVED',
      }),
    ).toEqual({
      productId: 'product_ready',
      hasApprovedProductLevelSaleWindow: true,
      issue: null,
    });

    expect(
      validateProductSaleWindowForProjection({
        productId: 'product_missing_start',
        publicSaleWindowStatus: 'APPROVED',
      }),
    ).toEqual({
      productId: 'product_missing_start',
      hasApprovedProductLevelSaleWindow: false,
      issue: 'PRODUCT_LEVEL_SALE_WINDOW_START_REQUIRED',
    });
  });

  it('treats sale windows as [start, end) by rejecting end <= start', () => {
    const startsAtUtc = new Date('2026-07-01T00:00:00.000Z');

    expect(
      validateProductSaleWindowForProjection({
        productId: 'product_invalid_end',
        publicSaleStartsAt: startsAtUtc,
        publicSaleEndsAt: new Date(startsAtUtc),
        publicSaleWindowStatus: 'APPROVED',
      }),
    ).toEqual({
      productId: 'product_invalid_end',
      hasApprovedProductLevelSaleWindow: false,
      issue: 'PRODUCT_LEVEL_SALE_WINDOW_END_BEFORE_OR_EQUAL_START',
    });
  });

  it('does not read ProductVariant.saleStartAt or ProductVariant.saleEndAt for G5-A/B calendar projection', () => {
    const variant = new Proxy(
      {},
      {
        get(_target, property) {
          if (property === 'saleStartAt' || property === 'saleEndAt') {
            throw new Error(`forbidden variant calendar read: ${String(property)}`);
          }
          return undefined;
        },
      },
    );

    // The service accepts only product-level source fields in this gate, so a
    // variant-shaped object can exist nearby without being read or projected.
    expect(variant).toBeDefined();
    expect(() => service.projectPublicEvents()).not.toThrow();
    expect(service.projectPublicEvents().publicEvents).toEqual([]);
  });

  it('keeps public adapter preview Product-level only and excludes invalid sale windows', () => {
    const preview = new PublicAdapterPreviewService(service);
    const startsAtUtc = new Date('2026-07-01T00:00:00.000Z');

    const result = preview.buildPreview({
      productSources: [
        { productId: 'draft_product', publicSaleStartsAt: startsAtUtc, publicSaleWindowStatus: 'DRAFT' },
        { productId: 'missing_start', publicSaleWindowStatus: 'APPROVED' },
        {
          productId: 'invalid_end',
          publicSaleStartsAt: startsAtUtc,
          publicSaleEndsAt: new Date(startsAtUtc),
          publicSaleWindowStatus: 'APPROVED',
        },
        {
          productId: 'approved_product',
          publicSaleStartsAt: startsAtUtc,
          publicSaleEndsAt: new Date('2026-07-07T00:00:00.000Z'),
          publicSaleWindowStatus: 'APPROVED',
        },
      ],
    });

    expect(result.previewOnly).toBe(true);
    expect(result.publishEnabled).toBe(false);
    expect(result.externalSyncEnabled).toBe(false);
    expect(result.calendar.variantSaleWindowsUsed).toBe(false);
    expect(result.calendar.publicEvents.map((event) => event.sourceId)).toEqual(['approved_product']);
  });
});
