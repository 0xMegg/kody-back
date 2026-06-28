// ---------------------------------------------------------------------------
// G1a — Category contract (source-only).
//
// Pure, source-only vocabulary + validator for the four-dimensional category
// model (artist, artistDetail, type, typeDetail). This module has NO I/O: no
// DB, no network, no Prisma client, no repository/service import. It defines its
// OWN vocabulary and deliberately does NOT reconcile against the shipped
// `category`/`categoryMinor`/`itemType` enums — that reconciliation is a later
// schema gate, not G1.
//
// Hard scope rules encoded here as contract (not just docs):
//   - `typeDetail` is zero-or-one. Multi-select (two-or-more) is rejected.
//   - `x` is accepted in forward mode ONLY when accompanied by caller-supplied
//     source-category/tree evidence. The product NAME is never an input to this
//     contract, so name-regex inference of any dimension is impossible by
//     construction — there is no parameter to infer from.
//   - Forward mode is strict (violations => not accepted). Legacy mode is
//     tolerant (violations are reported but tolerated; legacy rows never throw).
// ---------------------------------------------------------------------------

/**
 * The closed `typeDetail` vocabulary. `typeDetail` is at most one of these.
 * `x` is the only value that additionally requires source-category evidence in
 * forward mode (see validateCategorySelection).
 */
export type TypeDetail = 'magazine' | 'sg' | 'members-only' | 'pob' | 'luckydraw' | 'x' | 'membership';

/** Every known `typeDetail` value, in declaration order. */
export const TYPE_DETAIL_VALUES: readonly TypeDetail[] = [
  'magazine',
  'sg',
  'members-only',
  'pob',
  'luckydraw',
  'x',
  'membership',
] as const;

const TYPE_DETAIL_SET: ReadonlySet<string> = new Set<string>(TYPE_DETAIL_VALUES);

/** Narrow an arbitrary value to a known `typeDetail`. */
export function isKnownTypeDetail(value: unknown): value is TypeDetail {
  return typeof value === 'string' && TYPE_DETAIL_SET.has(value);
}

export type CategoryValidationMode = 'forward' | 'legacy';

/**
 * Source-only category selection.
 *
 * `typeDetail` may be supplied as a scalar, as `null`/absent (zero), or as an
 * array (e.g. from a multi-select UI). An array carrying more than one value is
 * a violation; a 0/1-length array is normalized to null/scalar.
 *
 * `sourceCategoryEvidence` is the caller-supplied source-category/tree tokens
 * that justify the selected `typeDetail`. Non-blank evidence is the ONLY basis
 * on which `x` is accepted in forward mode. There is intentionally no product
 * name field — this contract cannot infer a dimension from a name.
 */
export interface CategorySelectionInput {
  artist?: string | null;
  artistDetail?: string | null;
  type?: string | null;
  typeDetail?: TypeDetail | readonly TypeDetail[] | null;
  /**
   * Caller-supplied evidence that the `typeDetail` was carried by the SOURCE
   * category/tree (not derived from a product name). Blank/whitespace tokens are
   * ignored; presence of at least one non-blank token counts as evidence.
   */
  sourceCategoryEvidence?: readonly string[] | null;
}

export type CategoryViolationCode =
  /** `typeDetail` carried two-or-more values (multi-select not allowed). */
  | 'TYPE_DETAIL_MULTIPLE'
  /** `typeDetail` value is outside the known vocabulary. */
  | 'TYPE_DETAIL_UNKNOWN'
  /** `x` was selected without source-category evidence. */
  | 'TYPE_DETAIL_X_REQUIRES_SOURCE_EVIDENCE';

export interface CategoryViolation {
  code: CategoryViolationCode;
  dimension: 'typeDetail';
  message: string;
}

export interface CategoryValidationResult {
  mode: CategoryValidationMode;
  /**
   * Forward: true only when there are no violations. Legacy: always true —
   * violations are tolerated, never rejected.
   */
  accepted: boolean;
  /** The single resolved `typeDetail`, or null when none/zero was supplied. */
  normalizedTypeDetail: TypeDetail | null;
  /** Whether non-blank source-category evidence was supplied. */
  hasSourceEvidence: boolean;
  /** All detected rule violations (populated in both modes). */
  violations: readonly CategoryViolation[];
  /**
   * True when violations were tolerated (legacy mode) rather than rejected
   * (forward mode). Always false when there are no violations.
   */
  tolerated: boolean;
}

/** True when at least one non-blank evidence token is present. */
function hasNonBlankEvidence(evidence: readonly string[] | null | undefined): boolean {
  if (!evidence) {
    return false;
  }
  return evidence.some((token) => typeof token === 'string' && token.trim().length > 0);
}

/**
 * Reduce a scalar/array/null `typeDetail` to "the single value, if exactly one"
 * plus a flag for the multi-select violation. A 0-length array and null/absent
 * both collapse to null. A 1-length array collapses to its single element.
 */
function reduceTypeDetail(raw: CategorySelectionInput['typeDetail']): {
  value: TypeDetail | null;
  multiple: boolean;
} {
  if (raw === null || raw === undefined) {
    return { value: null, multiple: false };
  }
  if (Array.isArray(raw)) {
    const distinct = Array.from(new Set(raw));
    if (distinct.length === 0) {
      return { value: null, multiple: false };
    }
    if (distinct.length > 1) {
      // Report the first value for diagnostics, but flag the multi violation.
      return { value: distinct[0] ?? null, multiple: true };
    }
    return { value: distinct[0] ?? null, multiple: false };
  }
  return { value: raw as TypeDetail, multiple: false };
}

/**
 * Validate a source-only category selection.
 *
 * Forward mode (strict): any violation => `accepted: false`, `tolerated: false`.
 * Legacy mode (tolerant): violations are still reported, but `accepted: true`
 * and `tolerated: true` — existing/legacy rows are never rejected and this never
 * throws. The product name is never consulted (it is not an input), so `x` can
 * only be accepted via supplied source evidence.
 */
export function validateCategorySelection(
  input: CategorySelectionInput,
  opts: { mode: CategoryValidationMode },
): CategoryValidationResult {
  const { mode } = opts;
  const violations: CategoryViolation[] = [];

  const { value: normalizedTypeDetail, multiple } = reduceTypeDetail(input.typeDetail);
  const hasSourceEvidence = hasNonBlankEvidence(input.sourceCategoryEvidence);

  if (multiple) {
    violations.push({
      code: 'TYPE_DETAIL_MULTIPLE',
      dimension: 'typeDetail',
      message: 'typeDetail accepts at most one value; multi-select is not allowed.',
    });
  }

  if (normalizedTypeDetail !== null && !isKnownTypeDetail(normalizedTypeDetail)) {
    violations.push({
      code: 'TYPE_DETAIL_UNKNOWN',
      dimension: 'typeDetail',
      message: `Unknown typeDetail value: ${String(normalizedTypeDetail)}.`,
    });
  }

  if (normalizedTypeDetail === 'x' && !hasSourceEvidence) {
    violations.push({
      code: 'TYPE_DETAIL_X_REQUIRES_SOURCE_EVIDENCE',
      dimension: 'typeDetail',
      message: 'typeDetail "x" requires caller-supplied source-category evidence; product name is never inferred.',
    });
  }

  const hasViolations = violations.length > 0;
  const tolerated = mode === 'legacy' && hasViolations;
  const accepted = mode === 'legacy' ? true : !hasViolations;

  return {
    mode,
    accepted,
    normalizedTypeDetail: isKnownTypeDetail(normalizedTypeDetail) ? normalizedTypeDetail : null,
    hasSourceEvidence,
    violations,
    tolerated,
  };
}
