import type { CalendarProjectionStatus, CalendarSourceType } from '@/domain/shared/types.js';

export interface CalendarEventProjectionDraft {
  id: string;
  sourceType: CalendarSourceType;
  sourceId: string;
  startsAtUtc: Date | null;
  endsAtUtc: Date | null;
  timezone: string;
  status: CalendarProjectionStatus;
}

export interface ProductCalendarSourceReadiness {
  productId: string;
  hasApprovedProductLevelSaleWindow: boolean;
}

export interface CalendarProjectionResult {
  publicEvents: CalendarEventProjectionDraft[];
  reason: 'PRODUCT_LEVEL_SALE_WINDOW_NOT_APPROVED';
}

export class CalendarEventProjectionService {
  /**
   * G5-A/B-1 is readiness-only for calendar projection. Public calendar output
   * stays empty until a later gate approves a product-level sale-window source
   * and public adapter behavior. Variant sale-window fields are deliberately not
   * accepted by this method, which keeps option/variant calendar semantics in
   * G5-C instead of silently projecting them here.
   */
  projectPublicEvents(
    _sources: ProductCalendarSourceReadiness[] = [],
  ): CalendarProjectionResult {
    return {
      publicEvents: [],
      reason: 'PRODUCT_LEVEL_SALE_WINDOW_NOT_APPROVED',
    };
  }
}
