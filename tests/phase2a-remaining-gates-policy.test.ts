import { describe, expect, it } from 'vitest';
import {
  PHASE2A_REMAINING_GATE_SEQUENCE,
  assessG5ABSmokeDeployGate,
  assessG5C2StockOrderGate,
  assessG5C3WriteGate,
  assessG5DBulkDuplicateGate,
  assessG5ECateBridgeGate,
  planG5C2OrderLineVariantSplit,
  planG5DBulkProductWritePreview,
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
      skuPolicy: 'empty_until_operator_supplies_unique_value',
      barcodePolicy: 'empty_until_operator_supplies_unique_value',
      externalIdentityPolicy: 'empty_until_source_bridge_gate',
      imagePolicy: 'copy_by_reference',
      externalMappingsPolicy: 'blocked_requires_source_bridge_gate',
      stockCounterPolicy: 'blocked_never_copy_stock_counters',
      publicSaleAndPublicationPolicy: 'not_copied',
      sourceOwnershipPolicy: 'not_copied',
      writeAllowed: false,
    });
  });

  it('plans G5-D bulk writes as explicit-ID dry-run previews with stale-row and idempotency evidence', () => {
    const preview = planG5DBulkProductWritePreview({
      selectionMode: 'explicit_ids',
      productIds: [' P-1 ', 'P-2', 'P-1'],
      action: { kind: 'sale_period', saleStartAt: ' 2026-07-01T00:00:00.000Z ', saleEndAt: '2026-07-08T00:00:00.000Z' },
      preState: [
        { productId: 'P-1', updatedAt: '2026-06-25T00:00:00.000Z' },
        { productId: 'P-2', preStateHash: 'sha256:before-p2' },
      ],
      idempotencyKey: ' g5d-key-1 ',
    });

    expect(preview).toMatchObject({
      selectionMode: 'explicit_ids',
      requestedProductIds: ['P-1', 'P-2'],
      resolvedProductIds: ['P-1', 'P-2'],
      action: { kind: 'sale_period', saleStartAt: '2026-07-01T00:00:00.000Z', saleEndAt: '2026-07-08T00:00:00.000Z' },
      previewLimit: 100,
      runtimeWriteLimit: 50,
      staleRowGuard: 'updatedAt_or_preStateHash_required_per_product',
      idempotency: {
        scope: 'G5-D:bulk-product-write',
        key: 'g5d-key-1',
        ttlHours: 24,
        keyReusePolicy: 'same_key_different_payload_hash_reject_as_conflict',
      },
      runtimeBlockedReasons: ['source-only preview does not execute product writes'],
      partialFailureMode: 'validate_all_before_write_no_partial_success_in_first_slice',
      auditPayload: 'before_after_per_product_required_for_runtime_gate',
      openEndedFilterWriteAllowed: false,
      runtimeWriteAllowed: false,
    });
    expect(preview.idempotency.payloadHashSource).toContain('"productIds":["P-1","P-2"]');
    expect(preview.idempotency.payloadHashSource).toContain('"preStateHash":"sha256:before-p2"');
  });

  it('rejects G5-D open-ended filter writes and previews without per-product stale-row guards', () => {
    expect(() => planG5DBulkProductWritePreview({
      selectionMode: 'filter',
      productIds: ['P-1'],
      action: { kind: 'visibility', hidden: true },
      preState: [{ productId: 'P-1', updatedAt: '2026-06-25T00:00:00.000Z' }],
    })).toThrow('explicit product IDs only');

    expect(() => planG5DBulkProductWritePreview({
      selectionMode: 'explicit_ids',
      productIds: ['P-1', 'P-2'],
      action: { kind: 'sale_status', saleStatus: 'OFF_SALE' },
      preState: [{ productId: 'P-1', updatedAt: '2026-06-25T00:00:00.000Z' }],
      idempotencyKey: 'g5d-key-1',
    })).toThrow('G5-D stale-row guard missing for product IDs: P-2');
  });

  it('rejects invalid G5-D sale-period/actions and missing idempotency keys before runtime writes exist', () => {
    const guardedInput = {
      selectionMode: 'explicit_ids' as const,
      productIds: ['P-1'],
      preState: [{ productId: 'P-1', updatedAt: '2026-06-25T00:00:00.000Z' }],
    };

    expect(() => planG5DBulkProductWritePreview({
      ...guardedInput,
      action: { kind: 'sale_period', saleStartAt: '2026-07-08T00:00:00.000Z', saleEndAt: '2026-07-01T00:00:00.000Z' },
      idempotencyKey: 'g5d-key-1',
    })).toThrow('saleEndAt must be after saleStartAt');

    expect(() => planG5DBulkProductWritePreview({
      ...guardedInput,
      action: { kind: 'sale_period', saleStartAt: 'not-a-date', saleEndAt: null },
      idempotencyKey: 'g5d-key-1',
    })).toThrow('saleStartAt must be an ISO instant');

    expect(() => planG5DBulkProductWritePreview({
      ...guardedInput,
      action: { kind: 'sale_status', saleStatus: 'INVALID' } as never,
      idempotencyKey: 'g5d-key-1',
    })).toThrow('saleStatus must be ON_SALE');

    expect(() => planG5DBulkProductWritePreview({
      ...guardedInput,
      action: { kind: 'visibility', hidden: true },
      idempotencyKey: ' ',
    })).toThrow('idempotencyKey is required');
  });

  it('flags G5-D previews that exceed the first runtime write limit without silently truncating', () => {
    const productIds = Array.from({ length: 51 }, (_, index) => `P-${index + 1}`);
    const preview = planG5DBulkProductWritePreview({
      selectionMode: 'explicit_ids',
      productIds,
      action: { kind: 'sale_status', saleStatus: 'OFF_SALE' },
      preState: productIds.map((productId) => ({ productId, updatedAt: '2026-06-25T00:00:00.000Z' })),
      idempotencyKey: 'g5d-key-51',
    });

    expect(preview.resolvedProductIds).toHaveLength(51);
    expect(preview.runtimeBlockedReasons).toContain('resolved product count exceeds first runtime write limit of 50');
    expect(preview.runtimeWriteAllowed).toBe(false);
  });

  it('keeps G5-D idempotency hash source stable for reordered equivalent product sets', () => {
    const base = {
      selectionMode: 'explicit_ids' as const,
      action: { kind: 'sale_status' as const, saleStatus: 'OFF_SALE' as const },
      preState: [
        { productId: 'P-1', updatedAt: '2026-06-25T00:00:00.000Z' },
        { productId: 'P-2', updatedAt: '2026-06-25T00:00:00.000Z' },
      ],
      idempotencyKey: 'g5d-key-reordered',
    };

    const forward = planG5DBulkProductWritePreview({ ...base, productIds: ['P-1', 'P-2'] });
    const reordered = planG5DBulkProductWritePreview({ ...base, productIds: ['P-2', 'P-1'] });

    expect(forward.requestedProductIds).toEqual(['P-1', 'P-2']);
    expect(reordered.requestedProductIds).toEqual(['P-2', 'P-1']);
    expect(forward.idempotency.payloadHashSource).toEqual(reordered.idempotency.payloadHashSource);
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
