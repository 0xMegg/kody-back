import { describe, expect, it } from 'vitest';

import {
  TYPE_DETAIL_VALUES,
  isKnownTypeDetail,
  validateCategorySelection,
  type TypeDetail,
} from '@/application/product/category-contract.js';

describe('typeDetail vocabulary', () => {
  it('exposes exactly the seven known values', () => {
    expect([...TYPE_DETAIL_VALUES]).toEqual([
      'magazine',
      'sg',
      'members-only',
      'pob',
      'luckydraw',
      'x',
      'membership',
    ]);
  });

  it('narrows known values and rejects unknown ones', () => {
    for (const value of TYPE_DETAIL_VALUES) {
      expect(isKnownTypeDetail(value)).toBe(true);
    }
    expect(isKnownTypeDetail('teaser')).toBe(false);
    expect(isKnownTypeDetail(null)).toBe(false);
    expect(isKnownTypeDetail(undefined)).toBe(false);
  });
});

describe('validateCategorySelection — typeDetail cardinality (forward)', () => {
  it('accepts zero typeDetail (none / null / undefined)', () => {
    for (const typeDetail of [undefined, null, [] as TypeDetail[]]) {
      const result = validateCategorySelection({ typeDetail }, { mode: 'forward' });
      expect(result.accepted).toBe(true);
      expect(result.violations).toEqual([]);
      expect(result.normalizedTypeDetail).toBeNull();
    }
  });

  it('accepts exactly one typeDetail for every known value', () => {
    for (const value of TYPE_DETAIL_VALUES) {
      // `x` needs evidence; supply it so this row isolates the cardinality rule.
      const result = validateCategorySelection(
        { typeDetail: value, sourceCategoryEvidence: value === 'x' ? ['source/x'] : undefined },
        { mode: 'forward' },
      );
      expect(result.accepted).toBe(true);
      expect(result.normalizedTypeDetail).toBe(value);
      expect(result.violations).toEqual([]);
    }
  });

  it('normalizes a single-element array to its scalar value', () => {
    const result = validateCategorySelection({ typeDetail: ['magazine'] }, { mode: 'forward' });
    expect(result.accepted).toBe(true);
    expect(result.normalizedTypeDetail).toBe('magazine');
  });

  it('rejects two-or-more typeDetail values', () => {
    const result = validateCategorySelection({ typeDetail: ['magazine', 'sg'] }, { mode: 'forward' });
    expect(result.accepted).toBe(false);
    expect(result.violations.map((v) => v.code)).toContain('TYPE_DETAIL_MULTIPLE');
  });

  it('rejects an unknown typeDetail value in forward mode', () => {
    const result = validateCategorySelection(
      { typeDetail: 'teaser' as unknown as TypeDetail },
      { mode: 'forward' },
    );
    expect(result.accepted).toBe(false);
    expect(result.violations.map((v) => v.code)).toContain('TYPE_DETAIL_UNKNOWN');
    expect(result.normalizedTypeDetail).toBeNull();
  });
});

describe('validateCategorySelection — `x` requires source evidence (no name inference)', () => {
  it('accepts `x` when caller supplies source-category evidence', () => {
    const result = validateCategorySelection(
      { typeDetail: 'x', sourceCategoryEvidence: ['고객센터/X', 'tree/x'] },
      { mode: 'forward' },
    );
    expect(result.accepted).toBe(true);
    expect(result.hasSourceEvidence).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('rejects `x` with no evidence (there is no product-name input to infer from)', () => {
    const result = validateCategorySelection({ typeDetail: 'x' }, { mode: 'forward' });
    expect(result.accepted).toBe(false);
    expect(result.violations.map((v) => v.code)).toContain('TYPE_DETAIL_X_REQUIRES_SOURCE_EVIDENCE');
  });

  it('treats blank/whitespace-only evidence as absent', () => {
    const result = validateCategorySelection(
      { typeDetail: 'x', sourceCategoryEvidence: ['   ', ''] },
      { mode: 'forward' },
    );
    expect(result.hasSourceEvidence).toBe(false);
    expect(result.accepted).toBe(false);
    expect(result.violations.map((v) => v.code)).toContain('TYPE_DETAIL_X_REQUIRES_SOURCE_EVIDENCE');
  });

  it('the contract has no product-name parameter — input keys are source-only', () => {
    // Compile-time guarantee in TS; assert at runtime that a stray `name` is
    // ignored and never flips `x` to accepted.
    const result = validateCategorySelection(
      { typeDetail: 'x', ...( { name: 'TXT' } as object) } as never,
      { mode: 'forward' },
    );
    expect(result.accepted).toBe(false);
    expect(result.violations.map((v) => v.code)).toContain('TYPE_DETAIL_X_REQUIRES_SOURCE_EVIDENCE');
  });
});

describe('validateCategorySelection — forward strict vs legacy tolerant', () => {
  it('legacy mode tolerates a multi-select violation instead of rejecting', () => {
    const result = validateCategorySelection({ typeDetail: ['magazine', 'sg'] }, { mode: 'legacy' });
    expect(result.accepted).toBe(true);
    expect(result.tolerated).toBe(true);
    expect(result.violations.map((v) => v.code)).toContain('TYPE_DETAIL_MULTIPLE');
  });

  it('legacy mode tolerates `x` without evidence (legacy rows never throw/reject)', () => {
    const result = validateCategorySelection({ typeDetail: 'x' }, { mode: 'legacy' });
    expect(result.accepted).toBe(true);
    expect(result.tolerated).toBe(true);
    expect(result.violations.map((v) => v.code)).toContain('TYPE_DETAIL_X_REQUIRES_SOURCE_EVIDENCE');
  });

  it('legacy mode tolerates an unknown typeDetail value', () => {
    const result = validateCategorySelection(
      { typeDetail: 'legacy-thing' as unknown as TypeDetail },
      { mode: 'legacy' },
    );
    expect(result.accepted).toBe(true);
    expect(result.tolerated).toBe(true);
    expect(result.violations.map((v) => v.code)).toContain('TYPE_DETAIL_UNKNOWN');
  });

  it('the same governed change is strict in forward but tolerant in legacy', () => {
    const input = { typeDetail: 'x' as const };
    expect(validateCategorySelection(input, { mode: 'forward' }).accepted).toBe(false);
    expect(validateCategorySelection(input, { mode: 'legacy' }).accepted).toBe(true);
  });

  it('a clean valid selection is accepted and not tolerated in both modes', () => {
    for (const mode of ['forward', 'legacy'] as const) {
      const result = validateCategorySelection(
        { artist: 'TXT', artistDetail: 'kpop', type: 'album', typeDetail: 'pob' },
        { mode },
      );
      expect(result.accepted).toBe(true);
      expect(result.tolerated).toBe(false);
      expect(result.violations).toEqual([]);
    }
  });
});
