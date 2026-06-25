import { describe, expect, it } from 'vitest';
import {
  PHASE2A_REMAINING_GATE_SEQUENCE,
  assessG5ABSmokeDeployGate,
  assessG5C2StockOrderGate,
  assessG5C3WriteGate,
  assessG5DBulkDuplicateGate,
  assessG5ECateBridgeGate,
  planG5C2OrderLineVariantSplit,
  planG5DProductDuplicatePreview,
} from '@/domain/product/phase2a-remaining-gates-policy.js';

describe('Phase2A remaining gate policy', () => {
  it('keeps the logical execution order stable', () => {
    expect(PHASE2A_REMAINING_GATE_SEQUENCE).toEqual(['G5-C-2', 'G5-C-3-WRITE', 'G5-D', 'G5-E', 'G5-A/B']);
  });

  it('allows only source-only G5-C-2 split-rule work without schema/write approvals', () => {
    const assessment = assessG5C2StockOrderGate({
      explicitSplitRuleApproved: true,
      variantStockBackfillEvidenceAvailable: false,
      schemaOrMigrationApproved: false,
      dbWriteApproved: false,
    });

    expect(assessment.disposition).toBe('source_only_allowed');
    expect(assessment.allowedNow).toContain('nullable OrderItem.variantId planning without migration/apply');
    expect(assessment.forbiddenUntilCleared).toContain('variant-authoritative stock mutation');
    expect(assessment.blockers).toEqual([
      'schema/migration approval missing for OrderItem.variantId runtime persistence',
      'DB write/backfill approval missing',
    ]);
  });

  it('keeps G5-C-2 stock authority changes forbidden even if nullable line-link prerequisites are satisfied', () => {
    const assessment = assessG5C2StockOrderGate({
      explicitSplitRuleApproved: true,
      variantStockBackfillEvidenceAvailable: false,
      schemaOrMigrationApproved: true,
      dbWriteApproved: true,
    });

    expect(assessment.disposition).toBe('runtime_write_allowed');
    expect(assessment.forbiddenUntilCleared).toEqual([
      'inventory reservation/decrement by variant',
      'shipment/stock movement variant relations',
      'variant-authoritative stock mutation',
    ]);
  });

  it('plans G5-C-2 order line variant split as nullable reference while product stock remains authority', () => {
    expect(planG5C2OrderLineVariantSplit({ productId: ' P-ATEZ-001 ', variantId: ' variant_1 ' })).toEqual({
      productId: 'P-ATEZ-001',
      variantId: 'variant_1',
      orderItemVariantLinkMode: 'nullable_additive_reference_only',
      stockAuthority: 'product',
      variantStockMutationAllowed: false,
      historicalBackfillAllowed: false,
    });
    expect(planG5C2OrderLineVariantSplit({ productId: 'P-ATEZ-001' }).variantId).toBeNull();
  });

  it('blocks G5-C-3 write path until auth/target/pre-state/restore and commit guard review exist', () => {
    const assessment = assessG5C3WriteGate({
      validAuthAvailable: false,
      exactTargetSetApproved: false,
      preStateCaptureAvailable: false,
      rollbackOrRestorePlanAvailable: false,
      commitGuardReviewedForRemoval: false,
    });

    expect(assessment.disposition).toBe('blocked_missing_prerequisite');
    expect(assessment.allowedNow).toEqual(['dry-run planner/tests/evidence only']);
    expect(assessment.forbiddenUntilCleared).toContain('import commit/reimport/backfill write');
  });

  it('keeps G5-D source-only until G5-C is stable and real-write policy is approved', () => {
    const assessment = assessG5DBulkDuplicateGate({
      g5cSourceSemanticsStable: true,
      maxBatchSizeApproved: false,
      realWriteApproved: false,
    });

    expect(assessment.disposition).toBe('source_only_allowed');
    expect(assessment.allowedNow).toContain('bulk/duplicate dry-run planner');
    expect(assessment.forbiddenUntilCleared).toContain('duplicate product creation');
  });

  it('previews duplicate policy without copying source mappings or stock counters', () => {
    expect(planG5DProductDuplicatePreview({
      sourceProductId: ' P-1 ',
      copyImagesByReference: true,
      copyExternalMappings: true,
      copyStockCounters: true,
    })).toEqual({
      sourceProductId: 'P-1',
      defaultStatus: 'DRAFT',
      duplicateMarker: 'COPY_PENDING_REVIEW',
      imagePolicy: 'copy_by_reference',
      externalMappingsPolicy: 'blocked_requires_source_bridge_gate',
      stockCounterPolicy: 'blocked_never_copy_stock_counters',
      writeAllowed: false,
    });
  });

  it('blocks G5-E CATE bridge without admin export tree or explicit per-CATE approval', () => {
    const assessment = assessG5ECateBridgeGate({
      imwebAdminCategoryExportTreeAvailable: false,
      explicitPerCateApprovals: [],
      realWriteApproved: false,
    });

    expect(assessment.disposition).toBe('blocked_missing_prerequisite');
    expect(assessment.blockers).toContain('missing Imweb admin category export/tree or explicit per-CATE mapping approval');
    expect(assessment.forbiddenUntilCleared).toContain('CATE canonical mapping/backfill/write derived from dry-run majority alone');
  });

  it('keeps G5-A/B deploy/write smoke read-only when auth/target/rollback/deploy binding are missing', () => {
    const assessment = assessG5ABSmokeDeployGate({
      validAuthAvailable: false,
      exactSafeTargetAvailable: false,
      rollbackHandleAvailable: false,
      deployTargetBound: false,
      production: true,
      productionGoNoGoRenewed: false,
    });

    expect(assessment.disposition).toBe('blocked_missing_prerequisite');
    expect(assessment.allowedNow).toEqual(['read-only health/preflight only']);
    expect(assessment.blockers).toContain('production go/no-go must be renewed with exact target and rollback handle');
    expect(assessment.forbiddenUntilCleared).toContain('authenticated data mutation smoke');
  });

  it('can model a renewed production go/no-go only when every concrete runtime prerequisite is present', () => {
    const assessment = assessG5ABSmokeDeployGate({
      validAuthAvailable: true,
      exactSafeTargetAvailable: true,
      rollbackHandleAvailable: true,
      deployTargetBound: true,
      production: true,
      productionGoNoGoRenewed: true,
    });

    expect(assessment).toEqual({
      gateId: 'G5-A/B',
      disposition: 'runtime_write_allowed',
      allowedNow: ['bounded write/deploy smoke'],
      blockers: [],
      forbiddenUntilCleared: [],
    });
  });
});
