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
    imagePolicy: input.copyImagesByReference ? 'copy_by_reference' : 'omit_until_review',
    externalMappingsPolicy: input.copyExternalMappings ? 'blocked_requires_source_bridge_gate' : 'omit',
    stockCounterPolicy: input.copyStockCounters ? 'blocked_never_copy_stock_counters' : 'reset_to_zero',
    writeAllowed: false,
  } as const;
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
