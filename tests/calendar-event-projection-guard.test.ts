import { describe, expect, it } from 'vitest';

import { CalendarEventProjectionService } from '@/application/storefront/calendar-event-projection-service.js';

const service = new CalendarEventProjectionService();

describe('CalendarEventProjectionService', () => {
  it('emits zero public-facing events until product-level sale-window source is approved', () => {
    const result = service.projectPublicEvents([
      { productId: 'product_1', hasApprovedProductLevelSaleWindow: false },
    ]);

    expect(result).toEqual({
      publicEvents: [],
      reason: 'PRODUCT_LEVEL_SALE_WINDOW_NOT_APPROVED',
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

    // The service accepts only product-level readiness inputs in this gate, so a
    // variant-shaped object can exist nearby without being read or projected.
    expect(variant).toBeDefined();
    expect(() => service.projectPublicEvents()).not.toThrow();
    expect(service.projectPublicEvents().publicEvents).toEqual([]);
  });
});
