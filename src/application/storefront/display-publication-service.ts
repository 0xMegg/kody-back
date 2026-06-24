import type { DisplayLifecycleState, ProductSaleStatus } from '@/domain/shared/types.js';

export interface StorefrontProductSummary {
  id: string;
  saleStatus: ProductSaleStatus;
  isDisplayed: boolean;
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

const PUBLIC_PRODUCT_SALE_STATUSES = new Set<ProductSaleStatus>(['ON_SALE', 'SOLD_OUT']);

function bySortPositionThenId<T extends { sortPosition: number }>(
  getId: (item: T) => string,
): (left: T, right: T) => number {
  return (left, right) => left.sortPosition - right.sortPosition || getId(left).localeCompare(getId(right));
}

export class DisplayPublicationService {
  isPublicProductEligible(product: StorefrontProductSummary): boolean {
    return product.isDisplayed && PUBLIC_PRODUCT_SALE_STATUSES.has(product.saleStatus);
  }

  previewLayout(layout: HomepageLayoutDraft): HomepageLayoutProjection {
    return {
      layoutId: layout.id,
      version: layout.version,
      state: layout.state,
      isPublic: false,
      collections: this.projectCollections(layout),
    };
  }

  publicProjection(layout: HomepageLayoutDraft): HomepageLayoutProjection {
    return {
      layoutId: layout.id,
      version: layout.version,
      state: layout.state,
      isPublic: layout.state === 'PUBLISHED',
      collections: layout.state === 'PUBLISHED' ? this.projectCollections(layout) : [],
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

  private projectCollections(layout: HomepageLayoutDraft): PublicCollectionProjection[] {
    return [...layout.collections]
      .sort(bySortPositionThenId((placement) => placement.collection.id))
      .map((placement) => ({
        id: placement.collection.id,
        name: placement.collection.name,
        sortPosition: placement.sortPosition,
        productIds: this.projectCollectionProductIds(placement.collection),
      }));
  }

  private projectCollectionProductIds(collection: DisplayCollectionDraft): string[] {
    if (collection.lifecycleState !== 'PUBLISHED') return [];

    return [...collection.products]
      .filter((placement) => this.isPublicProductEligible(placement.product))
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
