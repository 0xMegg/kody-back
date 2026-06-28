import { describe, expect, it } from 'vitest';

import {
  classifySku,
  evaluateSkuReview,
  isDirtySkuState,
  type SkuState,
} from '@/application/product/sku-contract.js';

describe('classifySku — dirty/clean taxonomy', () => {
  const cases: Array<{ raw: string | null | undefined; state: SkuState }> = [
    { raw: null, state: 'blank' },
    { raw: undefined, state: 'blank' },
    { raw: '', state: 'blank' },
    { raw: '   ', state: 'blank' },
    { raw: '590g', state: 'weight_like' },
    { raw: '1.5kg', state: 'weight_like' },
    { raw: '200 ml', state: 'weight_like' },
    { raw: '8809123456789', state: 'barcode_like' },
    { raw: 'A / B', state: 'delimited' },
    { raw: 'A,B', state: 'delimited' },
    { raw: 'A|B', state: 'delimited' },
    { raw: 'ALBUM-001', state: 'clean' },
    { raw: 'sku_123', state: 'clean' },
    { raw: '12345', state: 'clean' }, // short numeric is a clean code, not a barcode
    { raw: 'A B', state: 'untrusted' }, // space, no delimiter, not a clean token
    { raw: '한글SKU', state: 'untrusted' },
    { raw: '@#$', state: 'untrusted' },
  ];

  for (const { raw, state } of cases) {
    it(`classifies ${JSON.stringify(raw)} as ${state}`, () => {
      expect(classifySku(raw).state).toBe(state);
    });
  }

  it('preserves the raw value verbatim (never rewrites dirty values)', () => {
    const result = classifySku('  590g  ');
    expect(result.state).toBe('weight_like');
    expect(result.raw).toBe('  590g  '); // untouched
    expect(result.normalized).toBe('590g'); // trimmed for comparison only
  });

  it('preserves raw for a delimited multi-value rather than splitting it', () => {
    const result = classifySku('A / B');
    expect(result.raw).toBe('A / B');
    expect(result.state).toBe('delimited');
  });

  it('marks weight/barcode/delimited/untrusted as dirty and blank/clean as not', () => {
    expect(isDirtySkuState('weight_like')).toBe(true);
    expect(isDirtySkuState('barcode_like')).toBe(true);
    expect(isDirtySkuState('delimited')).toBe(true);
    expect(isDirtySkuState('untrusted')).toBe(true);
    expect(isDirtySkuState('blank')).toBe(false);
    expect(isDirtySkuState('clean')).toBe(false);
  });
});

describe('evaluateSkuReview — same SKU reviews, never merges', () => {
  it('returns ok for a clean candidate not in the existing set', () => {
    const decision = evaluateSkuReview('ALBUM-001', new Set(['OTHER-1', 'OTHER-2']));
    expect(decision.action).toBe('ok');
    expect(decision.reason).toBe('unique');
    expect(decision.matchedSku).toBeNull();
  });

  it('returns review (never merge) when the same SKU exists on another product', () => {
    const decision = evaluateSkuReview('ALBUM-001', new Set(['ALBUM-001', 'OTHER-2']));
    expect(decision.action).toBe('review');
    // The headline invariant: a same SKU is NEVER a merge/idempotency key.
    expect(decision.action).not.toBe('merge' as never);
    expect(decision.reason).toBe('same_sku_exists');
    expect(decision.matchedSku).toBe('ALBUM-001');
  });

  it('compares trimmed and case-sensitive, and accepts an array of existing SKUs', () => {
    expect(evaluateSkuReview('  ALBUM-001  ', ['ALBUM-001']).action).toBe('review');
    expect(evaluateSkuReview('album-001', ['ALBUM-001']).action).toBe('ok'); // case-sensitive
  });

  it('returns ok for a blank candidate (nothing to review)', () => {
    expect(evaluateSkuReview(null, ['ALBUM-001']).reason).toBe('blank');
    expect(evaluateSkuReview('   ', ['ALBUM-001']).action).toBe('ok');
  });

  it('routes a dirty candidate to review even when unique', () => {
    const weight = evaluateSkuReview('590g', new Set<string>());
    expect(weight.action).toBe('review');
    expect(weight.reason).toBe('dirty_value');
    expect(weight.state).toBe('weight_like');

    const delimited = evaluateSkuReview('A / B', new Set<string>());
    expect(delimited.action).toBe('review');
    expect(delimited.reason).toBe('dirty_value');
  });

  it('prioritizes same-SKU review over dirty classification', () => {
    const decision = evaluateSkuReview('590g', new Set(['590g']));
    expect(decision.action).toBe('review');
    expect(decision.reason).toBe('same_sku_exists');
  });

  it('ignores blank entries in the existing-SKU set', () => {
    expect(evaluateSkuReview('ALBUM-001', ['', '   ', null, undefined]).action).toBe('ok');
  });
});
