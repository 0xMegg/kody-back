import { describe, expect, it } from 'vitest';

import {
  DuplicateVariantSkuError,
  InvalidSaleWindowError,
  PRODUCT_PUBLIC_SALE_WINDOW_ACTION_LOG_SCOPE,
  VARIANT_PURCHASE_LIMIT_PLACEMENT,
  VARIANT_SELLABLE_ACTION_LOG_SCOPE,
  assertUniqueNonNullVariantSkusPerProduct,
  findDuplicateNonNullVariantSkus,
  resolveEffectiveVariantIdentity,
  resolveEffectiveVariantSaleWindow,
  resolveVariantPriceAuthority,
} from '@/domain/product/variant-sellable-contract.js';

describe('audit scope separation (5.5)', () => {
  it('uses a variant scope distinct from the public sale-window scope', () => {
    expect(VARIANT_SELLABLE_ACTION_LOG_SCOPE).toBe('product_variant_sellable_contract');
    expect(VARIANT_SELLABLE_ACTION_LOG_SCOPE).not.toBe('product_public_sale_window');
    expect(VARIANT_SELLABLE_ACTION_LOG_SCOPE).not.toBe(PRODUCT_PUBLIC_SALE_WINDOW_ACTION_LOG_SCOPE);
  });

  it('locks purchase-limit placement to product level only (5.6)', () => {
    expect(VARIANT_PURCHASE_LIMIT_PLACEMENT).toBe('PRODUCT_LEVEL_ONLY');
  });
});

describe('resolveEffectiveVariantIdentity (5.1 inherit-at-read)', () => {
  it('uses the variant value when present', () => {
    expect(
      resolveEffectiveVariantIdentity({
        variantSku: 'VAR-1',
        variantBarcode: 'BAR-VAR',
        productSku: 'PROD-1',
        productBarcode: 'BAR-PROD',
      }),
    ).toEqual({
      effectiveSku: 'VAR-1',
      effectiveBarcode: 'BAR-VAR',
      skuInherited: false,
      barcodeInherited: false,
    });
  });

  it('inherits the product value when the variant value is null', () => {
    expect(
      resolveEffectiveVariantIdentity({
        variantSku: null,
        variantBarcode: null,
        productSku: 'PROD-1',
        productBarcode: 'BAR-PROD',
      }),
    ).toEqual({
      effectiveSku: 'PROD-1',
      effectiveBarcode: 'BAR-PROD',
      skuInherited: true,
      barcodeInherited: true,
    });
  });

  it('treats blank/whitespace variant values as absent and inherits', () => {
    expect(
      resolveEffectiveVariantIdentity({
        variantSku: '   ',
        variantBarcode: '',
        productSku: 'PROD-1',
        productBarcode: 'BAR-PROD',
      }),
    ).toEqual({
      effectiveSku: 'PROD-1',
      effectiveBarcode: 'BAR-PROD',
      skuInherited: true,
      barcodeInherited: true,
    });
  });

  it('trims surrounding whitespace on present values', () => {
    expect(resolveEffectiveVariantIdentity({ variantSku: '  VAR-1  ', productSku: 'PROD-1' }).effectiveSku).toBe(
      'VAR-1',
    );
  });

  it('returns null (not inherited) when neither variant nor product provides a value', () => {
    expect(resolveEffectiveVariantIdentity({})).toEqual({
      effectiveSku: null,
      effectiveBarcode: null,
      skuInherited: false,
      barcodeInherited: false,
    });
  });
});

describe('per-product SKU uniqueness (5.1)', () => {
  it('allows multiple null/blank SKUs (nulls never collide)', () => {
    const variants = [
      { variantId: 'v1', sku: null },
      { variantId: 'v2', sku: '   ' },
      { variantId: 'v3' },
    ];
    expect(findDuplicateNonNullVariantSkus(variants)).toEqual([]);
    expect(() => assertUniqueNonNullVariantSkusPerProduct(variants)).not.toThrow();
  });

  it('rejects duplicate non-null SKUs (exact trimmed comparison)', () => {
    const variants = [
      { variantId: 'v1', sku: 'SKU-A' },
      { variantId: 'v2', sku: ' SKU-A ' },
      { variantId: 'v3', sku: 'SKU-B' },
    ];
    expect(findDuplicateNonNullVariantSkus(variants)).toEqual([
      { sku: 'SKU-A', indexes: [0, 1], variantIds: ['v1', 'v2'] },
    ]);
    expect(() => assertUniqueNonNullVariantSkusPerProduct(variants)).toThrow(DuplicateVariantSkuError);
  });

  it('treats SKU comparison as case-sensitive (no case folding)', () => {
    const variants = [{ sku: 'sku-a' }, { sku: 'SKU-A' }];
    expect(findDuplicateNonNullVariantSkus(variants)).toEqual([]);
  });

  it('accepts distinct non-null SKUs', () => {
    expect(() =>
      assertUniqueNonNullVariantSkusPerProduct([{ sku: 'A' }, { sku: 'B' }, { sku: null }]),
    ).not.toThrow();
  });
});

describe('resolveVariantPriceAuthority (4.2 — no delta double-counting)', () => {
  it('uses the absolute variant price and ignores option deltas', () => {
    const result = resolveVariantPriceAuthority({
      variantPriceKRW: '15000.0000',
      productPriceKRW: '10000.0000',
      optionPriceDeltasKRW: [500, 1000],
    });
    expect(result).toEqual({
      authority: 'VARIANT',
      priceKRW: '15000.0000',
      ignoredOptionDeltasKRW: [500, 1000],
      deltaSummationApplied: false,
    });
  });

  it('never sums delta + absolute variant price', () => {
    const result = resolveVariantPriceAuthority({
      variantPriceKRW: '15000.0000',
      productPriceKRW: '10000.0000',
      optionPriceDeltasKRW: [500],
    });
    // 15000 + 500 would be 15500 — explicitly NOT produced.
    expect(result.priceKRW).toBe('15000.0000');
    expect(result.deltaSummationApplied).toBe(false);
  });

  it('falls back to the product price when no variant price is present', () => {
    expect(resolveVariantPriceAuthority({ variantPriceKRW: null, productPriceKRW: '10000.0000' })).toEqual({
      authority: 'PRODUCT',
      priceKRW: '10000.0000',
      ignoredOptionDeltasKRW: [],
      deltaSummationApplied: false,
    });
    expect(resolveVariantPriceAuthority({ productPriceKRW: '10000.0000' }).authority).toBe('PRODUCT');
  });

  it('treats a blank/whitespace variant price as absent and falls back to the product price', () => {
    expect(resolveVariantPriceAuthority({ variantPriceKRW: '   ', productPriceKRW: '10000.0000' })).toEqual({
      authority: 'PRODUCT',
      priceKRW: '10000.0000',
      ignoredOptionDeltasKRW: [],
      deltaSummationApplied: false,
    });
  });
});

describe('resolveEffectiveVariantSaleWindow (5.4 / 4.5)', () => {
  const pStart = new Date('2026-07-01T00:00:00.000Z');
  const pEnd = new Date('2026-07-31T00:00:00.000Z');

  it('inherits the product window when both variant bounds are null', () => {
    const result = resolveEffectiveVariantSaleWindow({
      product: { startAt: pStart, endAt: pEnd },
      variant: { startAt: null, endAt: null },
    });
    expect(result).toEqual({ startAt: pStart, endAt: pEnd, inheritedFromProduct: true, isEmpty: false });
  });

  it('intersects product ∩ variant when variant bounds are set', () => {
    const vStart = new Date('2026-07-10T00:00:00.000Z');
    const vEnd = new Date('2026-07-20T00:00:00.000Z');
    const result = resolveEffectiveVariantSaleWindow({
      product: { startAt: pStart, endAt: pEnd },
      variant: { startAt: vStart, endAt: vEnd },
    });
    expect(result).toEqual({ startAt: vStart, endAt: vEnd, inheritedFromProduct: false, isEmpty: false });
  });

  it('never widens the product window (variant start earlier / end later is clamped)', () => {
    const result = resolveEffectiveVariantSaleWindow({
      product: { startAt: pStart, endAt: pEnd },
      variant: {
        startAt: new Date('2026-06-01T00:00:00.000Z'),
        endAt: new Date('2026-08-31T00:00:00.000Z'),
      },
    });
    expect(result.startAt).toEqual(pStart);
    expect(result.endAt).toEqual(pEnd);
    expect(result.inheritedFromProduct).toBe(false);
  });

  it('inherits a single bound when only one variant bound is set', () => {
    const vStart = new Date('2026-07-10T00:00:00.000Z');
    const result = resolveEffectiveVariantSaleWindow({
      product: { startAt: pStart, endAt: pEnd },
      variant: { startAt: vStart, endAt: null },
    });
    // variant start tightens; null variant end inherits product end.
    expect(result).toEqual({ startAt: vStart, endAt: pEnd, inheritedFromProduct: false, isEmpty: false });
  });

  it('preserves open-ended product bounds (null start/end remain open)', () => {
    const result = resolveEffectiveVariantSaleWindow({
      product: { startAt: null, endAt: null },
      variant: { startAt: null, endAt: null },
    });
    expect(result).toEqual({ startAt: null, endAt: null, inheritedFromProduct: true, isEmpty: false });
  });

  it('clamps an open-ended variant bound to the product bound (no widening past product)', () => {
    const result = resolveEffectiveVariantSaleWindow({
      product: { startAt: pStart, endAt: pEnd },
      variant: { startAt: null, endAt: new Date('2026-07-15T00:00:00.000Z') },
    });
    // null variant start inherits product start; variant end tightens.
    expect(result.startAt).toEqual(pStart);
    expect(result.endAt).toEqual(new Date('2026-07-15T00:00:00.000Z'));
  });

  it('flags a disjoint intersection as empty rather than throwing', () => {
    const result = resolveEffectiveVariantSaleWindow({
      product: { startAt: pStart, endAt: new Date('2026-07-05T00:00:00.000Z') },
      variant: {
        startAt: new Date('2026-07-10T00:00:00.000Z'),
        endAt: new Date('2026-07-20T00:00:00.000Z'),
      },
    });
    expect(result.isEmpty).toBe(true);
  });

  it('flags a variant window entirely before the product window as empty (symmetric)', () => {
    const result = resolveEffectiveVariantSaleWindow({
      product: { startAt: new Date('2026-07-10T00:00:00.000Z'), endAt: pEnd },
      variant: {
        startAt: new Date('2026-07-01T00:00:00.000Z'),
        endAt: new Date('2026-07-05T00:00:00.000Z'),
      },
    });
    expect(result.isEmpty).toBe(true);
  });

  it('rejects an invalid product window where start >= end', () => {
    expect(() =>
      resolveEffectiveVariantSaleWindow({
        product: { startAt: pEnd, endAt: pStart },
        variant: { startAt: null, endAt: null },
      }),
    ).toThrow(InvalidSaleWindowError);
  });

  it('rejects an invalid variant window where start == end (half-open [start, end))', () => {
    const t = new Date('2026-07-10T00:00:00.000Z');
    expect(() =>
      resolveEffectiveVariantSaleWindow({
        product: { startAt: pStart, endAt: pEnd },
        variant: { startAt: t, endAt: new Date(t) },
      }),
    ).toThrow(InvalidSaleWindowError);
  });
});
