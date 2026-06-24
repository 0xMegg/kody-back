import type { CalendarEventProjectionDraft, CalendarEventProjectionService, ProductCalendarSourceReadiness } from './calendar-event-projection-service.js';

export interface PublicAdapterPreviewInput {
  productSources?: ProductCalendarSourceReadiness[];
}

export interface PublicAdapterPreviewResult {
  previewOnly: true;
  publishEnabled: false;
  externalSyncEnabled: false;
  source: 'OMS_PRODUCT_PUBLIC_SALE_WINDOW';
  calendar: {
    publicEvents: CalendarEventProjectionDraft[];
    reason: string | null;
    variantSaleWindowsUsed: false;
  };
}

export class PublicAdapterPreviewService {
  constructor(private readonly calendarEvents: CalendarEventProjectionService) {}

  /**
   * G5-A/B-6 first slice is source/test only. Callers provide in-memory or mocked
   * Product-level public sale-window sources; the service does not read the DB,
   * enqueue sync work, publish externally, or inspect ProductVariant sale windows.
   */
  buildPreview(input: PublicAdapterPreviewInput = {}): PublicAdapterPreviewResult {
    const projection = this.calendarEvents.projectPublicEvents(input.productSources ?? []);

    return {
      previewOnly: true,
      publishEnabled: false,
      externalSyncEnabled: false,
      source: 'OMS_PRODUCT_PUBLIC_SALE_WINDOW',
      calendar: {
        publicEvents: projection.publicEvents,
        reason: projection.reason,
        variantSaleWindowsUsed: false,
      },
    };
  }
}
