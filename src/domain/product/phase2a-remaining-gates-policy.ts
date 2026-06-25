export type Phase2aRemainingGateId = 'G5-C-2' | 'G5-C-3-WRITE' | 'G5-D' | 'G5-E' | 'G5-A/B';

export type GateDisposition = 'source_only_allowed' | 'blocked_missing_prerequisite' | 'runtime_write_allowed';

export interface GateAssessment {
  gateId: Phase2aRemainingGateId;
  disposition: GateDisposition;
  allowedNow: string[];
  blockers: string[];
  forbiddenUntilCleared: string[];
}

export const PHASE2A_REMAINING_GATE_SEQUENCE: readonly Phase2aRemainingGateId[] = [
  'G5-C-2',
  'G5-C-3-WRITE',
  'G5-D',
  'G5-E',
  'G5-A/B',
] as const;

const DB_WRITE_FORBIDDEN = [
  'Prisma schema migration/apply',
  'DB write/import/reimport/backfill',
  'runtime deploy/prod mutation',
  'commit/push/PR/merge without separate source-publication gate',
] as const;

const G5C2_STOCK_AUTHORITY_FORBIDDEN = [
  'inventory reservation/decrement by variant',
  'shipment/stock movement variant relations',
  'variant-authoritative stock mutation',
] as const;

export interface G5C2StockOrderInput {
  explicitSplitRuleApproved: boolean;
  variantStockBackfillEvidenceAvailable: boolean;
  schemaOrMigrationApproved: boolean;
  dbWriteApproved: boolean;
}

export function assessG5C2StockOrderGate(input: G5C2StockOrderInput): GateAssessment {
  const sourceAllowed = input.explicitSplitRuleApproved || input.variantStockBackfillEvidenceAvailable;
  const runtimeWriteAllowed = sourceAllowed && input.schemaOrMigrationApproved && input.dbWriteApproved;

  return {
    gateId: 'G5-C-2',
    disposition: runtimeWriteAllowed ? 'runtime_write_allowed' : sourceAllowed ? 'source_only_allowed' : 'blocked_missing_prerequisite',
    allowedNow: sourceAllowed
      ? [
          'source-only split-rule contract/tests',
          'nullable OrderItem.variantId planning without migration/apply',
          'product-stock-authoritative characterization tests',
        ]
      : ['orchestration/evidence packet only'],
    blockers: [
      ...(!sourceAllowed ? ['missing 5.2 variant stock backfill source evidence or explicit split-rule approval'] : []),
      ...(!input.schemaOrMigrationApproved ? ['schema/migration approval missing for OrderItem.variantId runtime persistence'] : []),
      ...(!input.dbWriteApproved ? ['DB write/backfill approval missing'] : []),
    ],
    forbiddenUntilCleared: [
      ...(!runtimeWriteAllowed ? ['OrderItem.variantId migration/apply', 'historical order backfill'] : []),
      ...G5C2_STOCK_AUTHORITY_FORBIDDEN,
    ],
  };
}

export interface G5C2OrderLineVariantPlanInput {
  productId: string;
  variantId?: string | null;
}

export interface G5C2OrderLineVariantPlan {
  productId: string;
  variantId: string | null;
  orderItemVariantLinkMode: 'nullable_additive_reference_only';
  stockAuthority: 'product';
  variantStockMutationAllowed: false;
  historicalBackfillAllowed: false;
}

export function planG5C2OrderLineVariantSplit(input: G5C2OrderLineVariantPlanInput): G5C2OrderLineVariantPlan {
  return {
    productId: normalizeRequired(input.productId, 'productId'),
    variantId: normalizeOptional(input.variantId),
    orderItemVariantLinkMode: 'nullable_additive_reference_only',
    stockAuthority: 'product',
    variantStockMutationAllowed: false,
    historicalBackfillAllowed: false,
  };
}

export interface G5C3WriteInput {
  validAuthAvailable: boolean;
  exactTargetSetApproved: boolean;
  preStateCaptureAvailable: boolean;
  rollbackOrRestorePlanAvailable: boolean;
  commitGuardReviewedForRemoval: boolean;
}

export function assessG5C3WriteGate(input: G5C3WriteInput): GateAssessment {
  const blockers = [
    ...(!input.validAuthAvailable ? ['valid operator auth unavailable'] : []),
    ...(!input.exactTargetSetApproved ? ['exact target set not approved'] : []),
    ...(!input.preStateCaptureAvailable ? ['pre-state capture missing'] : []),
    ...(!input.rollbackOrRestorePlanAvailable ? ['rollback/restore plan missing'] : []),
    ...(!input.commitGuardReviewedForRemoval ? ['commit-disabled guard has not been replaced through reviewed write path'] : []),
  ];

  return {
    gateId: 'G5-C-3-WRITE',
    disposition: blockers.length === 0 ? 'runtime_write_allowed' : 'blocked_missing_prerequisite',
    allowedNow: blockers.length === 0 ? ['bounded import/reimport write smoke on approved targets'] : ['dry-run planner/tests/evidence only'],
    blockers,
    forbiddenUntilCleared: blockers.length === 0 ? [] : [...DB_WRITE_FORBIDDEN, 'import commit/reimport/backfill write'],
  };
}

export interface G5DBulkDuplicateInput {
  g5cSourceSemanticsStable: boolean;
  maxBatchSizeApproved: boolean;
  realWriteApproved: boolean;
}

export function assessG5DBulkDuplicateGate(input: G5DBulkDuplicateInput): GateAssessment {
  const sourceAllowed = input.g5cSourceSemanticsStable;
  const runtimeWriteAllowed = sourceAllowed && input.maxBatchSizeApproved && input.realWriteApproved;

  return {
    gateId: 'G5-D',
    disposition: runtimeWriteAllowed ? 'runtime_write_allowed' : sourceAllowed ? 'source_only_allowed' : 'blocked_missing_prerequisite',
    allowedNow: sourceAllowed
      ? ['bulk/duplicate dry-run planner', 'copy-policy characterization tests', 'RBAC/audit packet']
      : ['orchestration packet only'],
    blockers: [
      ...(!input.g5cSourceSemanticsStable ? ['G5-C source semantics not yet stable/closed'] : []),
      ...(!input.maxBatchSizeApproved ? ['max batch size/partial failure policy not approved'] : []),
      ...(!input.realWriteApproved ? ['real bulk write approval missing'] : []),
    ],
    forbiddenUntilCleared: runtimeWriteAllowed
      ? []
      : [...DB_WRITE_FORBIDDEN, 'bulk status/sale-period mutation', 'duplicate product creation'],
  };
}

export interface ProductDuplicatePreviewInput {
  sourceProductId: string;
  copyImagesByReference: boolean;
  copyExternalMappings: boolean;
  copyStockCounters: boolean;
}

export function planG5DProductDuplicatePreview(input: ProductDuplicatePreviewInput) {
  return {
    sourceProductId: normalizeRequired(input.sourceProductId, 'sourceProductId'),
    defaultStatus: 'DRAFT',
    duplicateMarker: 'COPY_PENDING_REVIEW',
    skuPolicy: 'empty_until_operator_supplies_unique_value',
    barcodePolicy: 'empty_until_operator_supplies_unique_value',
    externalIdentityPolicy: 'empty_until_source_bridge_gate',
    imagePolicy: input.copyImagesByReference ? 'copy_by_reference' : 'omit_until_review',
    externalMappingsPolicy: input.copyExternalMappings ? 'blocked_requires_source_bridge_gate' : 'omit',
    stockCounterPolicy: input.copyStockCounters ? 'blocked_never_copy_stock_counters' : 'reset_to_zero',
    publicSaleAndPublicationPolicy: 'not_copied',
    sourceOwnershipPolicy: 'not_copied',
    writeAllowed: false,
  } as const;
}

export type G5DBulkProductWriteAction =
  | { kind: 'sale_status'; saleStatus: 'ON_SALE' | 'OFF_SALE' | 'SOLD_OUT' | 'DRAFT' }
  | { kind: 'sale_period'; saleStartAt: string | null; saleEndAt: string | null }
  | { kind: 'visibility'; hidden: boolean };

export interface G5DBulkProductPreStateGuard {
  productId: string;
  updatedAt?: string | null;
  preStateHash?: string | null;
}

export interface G5DBulkProductWritePreviewInput {
  selectionMode: 'explicit_ids' | 'filter';
  productIds: readonly string[];
  action: G5DBulkProductWriteAction;
  preState: readonly G5DBulkProductPreStateGuard[];
  idempotencyKey?: string | null;
}

export interface G5DBulkProductWritePreview {
  selectionMode: 'explicit_ids';
  requestedProductIds: string[];
  resolvedProductIds: string[];
  action: G5DBulkProductWriteAction;
  previewLimit: 100;
  runtimeWriteLimit: 50;
  staleRowGuard: 'updatedAt_or_preStateHash_required_per_product';
  idempotency: {
    scope: 'G5-D:bulk-product-write';
    key: string;
    ttlHours: 24;
    payloadHashSource: string;
    keyReusePolicy: 'same_key_different_payload_hash_reject_as_conflict';
  };
  runtimeBlockedReasons: string[];
  partialFailureMode: 'validate_all_before_write_no_partial_success_in_first_slice';
  auditPayload: 'before_after_per_product_required_for_runtime_gate';
  openEndedFilterWriteAllowed: false;
  runtimeWriteAllowed: false;
}

export function planG5DBulkProductWritePreview(input: G5DBulkProductWritePreviewInput): G5DBulkProductWritePreview {
  if (input.selectionMode !== 'explicit_ids') {
    throw new Error('G5-D first runtime gate allows explicit product IDs only; filter writes are forbidden');
  }

  const requestedProductIds = normalizeUniqueProductIds(input.productIds);
  const payloadProductIds = [...requestedProductIds].sort(asciiCompare);
  if (requestedProductIds.length > 100) {
    throw new Error('G5-D preview cannot include more than 100 explicit product IDs');
  }
  const action = normalizeG5DBulkAction(input.action);
  const idempotencyKey = normalizeRequired(input.idempotencyKey ?? '', 'idempotencyKey');

  const guardByProductId = new Map(input.preState.map((guard) => [normalizeRequired(guard.productId, 'preState.productId'), guard]));
  const missingGuards = requestedProductIds.filter((productId) => {
    const guard = guardByProductId.get(productId);
    return !guard || (!normalizeOptional(guard.updatedAt) && !normalizeOptional(guard.preStateHash));
  });

  if (missingGuards.length > 0) {
    throw new Error(`G5-D stale-row guard missing for product IDs: ${missingGuards.join(', ')}`);
  }

  return {
    selectionMode: 'explicit_ids',
    requestedProductIds,
    // Source-only preview has no DB resolver; runtime gates may later differ if IDs are reloaded from the DB.
    resolvedProductIds: requestedProductIds,
    action,
    previewLimit: 100,
    runtimeWriteLimit: 50,
    staleRowGuard: 'updatedAt_or_preStateHash_required_per_product',
    idempotency: {
      scope: 'G5-D:bulk-product-write',
      key: idempotencyKey,
      ttlHours: 24,
      keyReusePolicy: 'same_key_different_payload_hash_reject_as_conflict',
      // Canonical source for the future runtime idempotency digest; the runtime gate must persist+compare it.
      payloadHashSource: stablePayloadHashSource({
        action,
        productIds: payloadProductIds,
        preState: payloadProductIds.map((productId) => {
          const guard = guardByProductId.get(productId);
          return {
            productId,
            updatedAt: normalizeOptional(guard?.updatedAt),
            preStateHash: normalizeOptional(guard?.preStateHash),
          };
        }),
      }),
    },
    runtimeBlockedReasons: [
      'source-only preview does not execute product writes',
      ...(requestedProductIds.length > 50 ? ['resolved product count exceeds first runtime write limit of 50'] : []),
    ],
    partialFailureMode: 'validate_all_before_write_no_partial_success_in_first_slice',
    auditPayload: 'before_after_per_product_required_for_runtime_gate',
    openEndedFilterWriteAllowed: false,
    runtimeWriteAllowed: false,
  };
}

export interface G5ECateBridgeInput {
  imwebAdminCategoryExportTreeAvailable: boolean;
  explicitPerCateApprovals: readonly string[];
  realWriteApproved: boolean;
}

export function assessG5ECateBridgeGate(input: G5ECateBridgeInput): GateAssessment {
  const sourceApproved = input.imwebAdminCategoryExportTreeAvailable || input.explicitPerCateApprovals.length > 0;
  const runtimeWriteAllowed = sourceApproved && input.realWriteApproved;

  return {
    gateId: 'G5-E',
    disposition: runtimeWriteAllowed ? 'runtime_write_allowed' : sourceApproved ? 'source_only_allowed' : 'blocked_missing_prerequisite',
    allowedNow: sourceApproved
      ? ['CATE mapping registry source update for approved codes/export tree', 'dry-run bridge report/tests']
      : ['evidence request packet and dry-run samples only'],
    blockers: [
      ...(!sourceApproved ? ['missing Imweb admin category export/tree or explicit per-CATE mapping approval'] : []),
      ...(!input.realWriteApproved ? ['real CATE bridge/backfill write approval missing'] : []),
    ],
    forbiddenUntilCleared: runtimeWriteAllowed
      ? []
      : [...DB_WRITE_FORBIDDEN, 'CATE canonical mapping/backfill/write derived from dry-run majority alone'],
  };
}

export interface G5ABSmokeDeployInput {
  validAuthAvailable: boolean;
  exactSafeTargetAvailable: boolean;
  rollbackHandleAvailable: boolean;
  deployTargetBound: boolean;
  production: boolean;
  productionGoNoGoRenewed?: boolean;
}

export function assessG5ABSmokeDeployGate(input: G5ABSmokeDeployInput): GateAssessment {
  const blockers = [
    ...(!input.validAuthAvailable ? ['valid ADMIN/FINANCE auth unavailable'] : []),
    ...(!input.exactSafeTargetAvailable ? ['exact safe product target unavailable'] : []),
    ...(!input.rollbackHandleAvailable ? ['rollback/restore handle unavailable'] : []),
    ...(!input.deployTargetBound ? ['deploy target/image/commit binding unavailable'] : []),
    ...(input.production && input.productionGoNoGoRenewed !== true
      ? ['production go/no-go must be renewed with exact target and rollback handle']
      : []),
  ];

  return {
    gateId: 'G5-A/B',
    disposition: blockers.length === 0 ? 'runtime_write_allowed' : 'blocked_missing_prerequisite',
    allowedNow: blockers.length === 0 ? ['bounded write/deploy smoke'] : ['read-only health/preflight only'],
    blockers,
    forbiddenUntilCleared: blockers.length === 0 ? [] : [...DB_WRITE_FORBIDDEN, 'authenticated data mutation smoke'],
  };
}

function normalizeRequired(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required`);
  return trimmed;
}

function normalizeOptional(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeUniqueProductIds(productIds: readonly string[]): string[] {
  const normalized = productIds.map((productId) => normalizeRequired(productId, 'productIds[]'));
  if (normalized.length === 0) throw new Error('G5-D preview requires at least one explicit product ID');
  return [...new Set(normalized)];
}

function normalizeG5DBulkAction(action: G5DBulkProductWriteAction): G5DBulkProductWriteAction {
  if (action.kind === 'sale_status') {
    if (!['ON_SALE', 'OFF_SALE', 'SOLD_OUT', 'DRAFT'].includes(action.saleStatus)) {
      throw new Error('G5-D saleStatus must be ON_SALE, OFF_SALE, SOLD_OUT, or DRAFT');
    }
    return action;
  }

  if (action.kind === 'sale_period') {
    const saleStartAt = normalizeOptional(action.saleStartAt);
    const saleEndAt = normalizeOptional(action.saleEndAt);
    validateIsoInstant(saleStartAt, 'saleStartAt');
    validateIsoInstant(saleEndAt, 'saleEndAt');
    if (saleStartAt && saleEndAt && Date.parse(saleEndAt) <= Date.parse(saleStartAt)) {
      throw new Error('G5-D saleEndAt must be after saleStartAt for [start,end) sale periods');
    }

    return {
      kind: 'sale_period',
      saleStartAt,
      saleEndAt,
    };
  }

  if (action.kind === 'visibility') {
    if (typeof action.hidden !== 'boolean') throw new Error('G5-D visibility.hidden must be boolean');
    return action;
  }

  throw new Error('G5-D action kind must be sale_status, sale_period, or visibility');
}

function validateIsoInstant(value: string | null, field: string): void {
  if (!value) return;
  if (Number.isNaN(Date.parse(value)) || !/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    throw new Error(`G5-D ${field} must be an ISO instant`);
  }
}

function stablePayloadHashSource(value: unknown): string {
  return JSON.stringify(sortStable(value));
}

function sortStable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortStable);
  if (value === null || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => asciiCompare(left, right))
      .map(([key, nested]) => [key, sortStable(nested)]),
  );
}

function asciiCompare(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
