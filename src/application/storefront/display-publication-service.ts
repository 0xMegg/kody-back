import { validateProductSaleWindowForProjection } from './calendar-event-projection-service.js';
import type { DisplayLifecycleState, ProductPublicSaleWindowStatus, ProductSaleStatus } from '@/domain/shared/types.js';

export interface StorefrontProductSummary {
  id: string;
  saleStatus: ProductSaleStatus;
  isDisplayed: boolean;
  publicSaleStartsAt?: Date | null;
  publicSaleEndsAt?: Date | null;
  publicSaleWindowStatus?: ProductPublicSaleWindowStatus | null;
}

export interface CollectionProductPlacement {
  product: StorefrontProductSummary;
  sortPosition: number;
  isPinned?: boolean;
}

export interface DisplayCollectionDraft {
  id: string;
  name: string;
  lifecycleState: DisplayLifecycleState;
  products: CollectionProductPlacement[];
}

export interface HomepageLayoutCollectionDraft {
  collection: DisplayCollectionDraft;
  sortPosition: number;
}

export interface HomepageLayoutDraft {
  id: string;
  version: number;
  state: DisplayLifecycleState;
  snapshotHash?: string;
  previousPublishedLayoutId?: string;
  collections: HomepageLayoutCollectionDraft[];
}

export interface PublicCollectionProjection {
  id: string;
  name: string;
  sortPosition: number;
  productIds: string[];
}

export interface HomepageLayoutProjection {
  layoutId: string;
  version: number;
  state: DisplayLifecycleState;
  isPublic: boolean;
  collections: PublicCollectionProjection[];
}

export interface StorefrontAuditScaffold {
  actorUserId: string | null;
  action: 'HOMEPAGE_LAYOUT_PUBLISH' | 'HOMEPAGE_LAYOUT_ROLLBACK';
  targetType: 'HomepageLayout';
  targetId: string;
  beforeJson: Record<string, unknown> | null;
  afterJson: Record<string, unknown>;
  createdAt: Date;
}

export interface PublishHomepageLayoutResult {
  publishedLayout: HomepageLayoutDraft & {
    state: 'PUBLISHED';
    publishedAt: Date;
    publishedByUserId: string | null;
    previousPublishedLayoutId?: string;
  };
  audit: StorefrontAuditScaffold;
}

export interface RollbackHomepageLayoutResult {
  restoredLayout: HomepageLayoutDraft & {
    state: 'PUBLISHED';
    publishedAt: Date;
    publishedByUserId: string | null;
    previousPublishedLayoutId: string;
  };
  audit: StorefrontAuditScaffold;
}

export interface HomepageProjectionOptions {
  now: Date;
}

const PUBLIC_PRODUCT_SALE_STATUSES = new Set<ProductSaleStatus>(['ON_SALE', 'SOLD_OUT']);

function bySortPositionThenId<T extends { sortPosition: number }>(
  getId: (item: T) => string,
): (left: T, right: T) => number {
  return (left, right) => left.sortPosition - right.sortPosition || getId(left).localeCompare(getId(right));
}

export class DisplayPublicationService {
  /**
   * Homepage public exposure is stricter than calendar projection:
   * calendar can project future APPROVED product sale-window events, while
   * homepage visibility requires the injected `now` to be inside the Product
   * level [start,end) public sale window. ProductVariant.saleStartAt/saleEndAt
   * are deliberately excluded; variant/option sale-window semantics belong to
   * a separate gate.
   */
  isPublicProductEligible(product: StorefrontProductSummary, now: Date): boolean {
    if (!product.isDisplayed || !PUBLIC_PRODUCT_SALE_STATUSES.has(product.saleStatus)) {
      return false;
    }

    const saleWindow = validateProductSaleWindowForProjection({
      productId: product.id,
      publicSaleStartsAt: product.publicSaleStartsAt,
      publicSaleEndsAt: product.publicSaleEndsAt,
      publicSaleWindowStatus: product.publicSaleWindowStatus,
    });

    if (!saleWindow.hasApprovedProductLevelSaleWindow || !product.publicSaleStartsAt) {
      return false;
    }

    if (product.publicSaleStartsAt > now) {
      return false;
    }

    if (product.publicSaleEndsAt && product.publicSaleEndsAt <= now) {
      return false;
    }

    return true;
  }

  previewLayout(layout: HomepageLayoutDraft, options: HomepageProjectionOptions): HomepageLayoutProjection {
    return {
      layoutId: layout.id,
      version: layout.version,
      state: layout.state,
      isPublic: false,
      collections: this.projectCollections(layout, options.now),
    };
  }

  publicProjection(layout: HomepageLayoutDraft, options: HomepageProjectionOptions): HomepageLayoutProjection {
    return {
      layoutId: layout.id,
      version: layout.version,
      state: layout.state,
      isPublic: layout.state === 'PUBLISHED',
      collections: layout.state === 'PUBLISHED' ? this.projectCollections(layout, options.now) : [],
    };
  }

  publishLayout(input: {
    draftLayout: HomepageLayoutDraft;
    currentPublishedLayout?: HomepageLayoutDraft;
    actorUserId?: string | null;
    now?: Date;
  }): PublishHomepageLayoutResult {
    const now = input.now ?? new Date();
    const actorUserId = input.actorUserId ?? null;
    const previousPublishedLayoutId = input.currentPublishedLayout?.id;
    const publishedLayout = {
      ...input.draftLayout,
      state: 'PUBLISHED' as const,
      publishedAt: now,
      publishedByUserId: actorUserId,
      previousPublishedLayoutId,
    };

    return {
      publishedLayout,
      audit: {
        actorUserId,
        action: 'HOMEPAGE_LAYOUT_PUBLISH',
        targetType: 'HomepageLayout',
        targetId: publishedLayout.id,
        beforeJson: input.currentPublishedLayout === undefined ? null : this.auditSnapshot(input.currentPublishedLayout),
        afterJson: this.auditSnapshot(publishedLayout),
        createdAt: now,
      },
    };
  }

  rollbackToPrevious(input: {
    currentPublishedLayout: HomepageLayoutDraft;
    previousPublishedLayout: HomepageLayoutDraft;
    actorUserId?: string | null;
    now?: Date;
  }): RollbackHomepageLayoutResult {
    const now = input.now ?? new Date();
    const actorUserId = input.actorUserId ?? null;
    const restoredLayout = {
      ...input.previousPublishedLayout,
      state: 'PUBLISHED' as const,
      version: input.currentPublishedLayout.version + 1,
      publishedAt: now,
      publishedByUserId: actorUserId,
      previousPublishedLayoutId: input.currentPublishedLayout.id,
    };

    return {
      restoredLayout,
      audit: {
        actorUserId,
        action: 'HOMEPAGE_LAYOUT_ROLLBACK',
        targetType: 'HomepageLayout',
        targetId: restoredLayout.id,
        beforeJson: this.auditSnapshot(input.currentPublishedLayout),
        afterJson: this.auditSnapshot(restoredLayout),
        createdAt: now,
      },
    };
  }

  private projectCollections(layout: HomepageLayoutDraft, now: Date): PublicCollectionProjection[] {
    return [...layout.collections]
      .sort(bySortPositionThenId((placement) => placement.collection.id))
      .map((placement) => ({
        id: placement.collection.id,
        name: placement.collection.name,
        sortPosition: placement.sortPosition,
        productIds: this.projectCollectionProductIds(placement.collection, now),
      }));
  }

  private projectCollectionProductIds(collection: DisplayCollectionDraft, now: Date): string[] {
    if (collection.lifecycleState !== 'PUBLISHED') return [];

    return [...collection.products]
      .filter((placement) => this.isPublicProductEligible(placement.product, now))
      .sort(bySortPositionThenId((placement) => placement.product.id))
      .map((placement) => placement.product.id);
  }

  private auditSnapshot(layout: HomepageLayoutDraft): Record<string, unknown> {
    return {
      layoutId: layout.id,
      version: layout.version,
      state: layout.state,
      snapshotHash: layout.snapshotHash,
      collectionIds: [...layout.collections]
        .sort(bySortPositionThenId((placement) => placement.collection.id))
        .map((placement) => placement.collection.id),
    };
  }
}
