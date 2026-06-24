import type {
  CalendarProjectionStatus,
  CalendarSourceType,
  ProductPublicSaleWindowStatus,
} from '@/domain/shared/types.js';

const KODY_PUBLIC_SALE_WINDOW_TIMEZONE = 'Asia/Seoul';

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
  publicSaleStartsAt?: Date | null;
  publicSaleEndsAt?: Date | null;
  publicSaleWindowStatus?: ProductPublicSaleWindowStatus | null;
}

export type ProductSaleWindowProjectionIssue =
  | 'PRODUCT_LEVEL_SALE_WINDOW_NOT_APPROVED'
  | 'PRODUCT_LEVEL_SALE_WINDOW_START_REQUIRED'
  | 'PRODUCT_LEVEL_SALE_WINDOW_END_BEFORE_OR_EQUAL_START';

export interface ProductSaleWindowProjectionEligibility {
  productId: string;
  hasApprovedProductLevelSaleWindow: boolean;
  issue: ProductSaleWindowProjectionIssue | null;
}

export interface CalendarProjectionResult {
  publicEvents: CalendarEventProjectionDraft[];
  reason: ProductSaleWindowProjectionIssue | null;
}

export function validateProductSaleWindowForProjection(
  source: ProductCalendarSourceReadiness,
): ProductSaleWindowProjectionEligibility {
  if (source.publicSaleWindowStatus !== 'APPROVED') {
    return {
      productId: source.productId,
      hasApprovedProductLevelSaleWindow: false,
      issue: 'PRODUCT_LEVEL_SALE_WINDOW_NOT_APPROVED',
    };
  }

  if (!source.publicSaleStartsAt) {
    return {
      productId: source.productId,
      hasApprovedProductLevelSaleWindow: false,
      issue: 'PRODUCT_LEVEL_SALE_WINDOW_START_REQUIRED',
    };
  }

  if (source.publicSaleEndsAt && source.publicSaleEndsAt <= source.publicSaleStartsAt) {
    return {
      productId: source.productId,
      hasApprovedProductLevelSaleWindow: false,
      issue: 'PRODUCT_LEVEL_SALE_WINDOW_END_BEFORE_OR_EQUAL_START',
    };
  }

  return {
    productId: source.productId,
    hasApprovedProductLevelSaleWindow: true,
    issue: null,
  };
}

export class CalendarEventProjectionService {
  /**
   * G5-A/B-3a projects only product-level public sale-window sources.
   * ProductVariant.saleStartAt/saleEndAt are deliberately not part of this
   * input contract, keeping option/variant calendar semantics in G5-C.
   *
   * Time contract: operators enter/display KST, persistence stores UTC DateTime,
   * and the sale window uses an end-exclusive [start, end) interval.
   */
  projectPublicEvents(sources: ProductCalendarSourceReadiness[] = []): CalendarProjectionResult {
    const publicEvents: CalendarEventProjectionDraft[] = [];
    let firstIssue: ProductSaleWindowProjectionIssue | null = sources.length
      ? null
      : 'PRODUCT_LEVEL_SALE_WINDOW_NOT_APPROVED';

    for (const source of sources) {
      const eligibility = validateProductSaleWindowForProjection(source);
      if (!eligibility.hasApprovedProductLevelSaleWindow) {
        firstIssue ??= eligibility.issue;
        continue;
      }

      publicEvents.push({
        id: `product-sale-window:${source.productId}`,
        sourceType: 'PRODUCT_SALE_WINDOW',
        sourceId: source.productId,
        startsAtUtc: source.publicSaleStartsAt ?? null,
        endsAtUtc: source.publicSaleEndsAt ?? null,
        timezone: KODY_PUBLIC_SALE_WINDOW_TIMEZONE,
        status: 'PUBLISHED',
      });
    }

    return {
      publicEvents,
      reason: publicEvents.length > 0 ? null : firstIssue,
    };
  }
}
