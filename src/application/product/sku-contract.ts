// ---------------------------------------------------------------------------
// G1a — SKU contract (source-only).
//
// Pure classification + review helpers for dirty/ambiguous SKU values. This
// module has NO I/O: no DB, no network, no Prisma client, no repository/service
// import. The same-SKU review takes a caller-supplied set of existing SKUs — it
// never queries for them.
//
// Two invariants are deliberately encoded as contract (not just docs):
//   - Dirty values are CLASSIFIED and PRESERVED verbatim (raw is never
//     rewritten), then routed to review — never silently normalized into a clean
//     value.
//   - A same SKU across products is a REVIEW signal, never a merge/idempotency
//     key. The review action type is `'ok' | 'review'` only — there is no
//     `'merge'`, so the no-merge rule holds by construction.
// ---------------------------------------------------------------------------

/**
 * Classification of a candidate SKU string.
 *   - `clean`        — a trustworthy SKU code (alphanumeric, may use `-`/`_`).
 *   - `blank`        — null/undefined/empty/whitespace-only.
 *   - `weight_like`  — a weight value mistakenly entered as a SKU, e.g. `590g`.
 *   - `barcode_like` — a long all-digit run that looks like a barcode/EAN.
 *   - `delimited`    — multiple values joined by a delimiter, e.g. `A / B`.
 *   - `untrusted`    — present but not a clean code and not another known shape.
 */
export type SkuState = 'clean' | 'blank' | 'weight_like' | 'barcode_like' | 'delimited' | 'untrusted';

export interface SkuClassification {
  state: SkuState;
  /** The original input, preserved verbatim. Never rewritten or normalized. */
  raw: string | null;
  /** Trimmed value for presence/comparison only; null when blank. */
  normalized: string | null;
}

/** States that are NOT safe to trust as a clean SKU and must be reviewed. */
const DIRTY_STATES: ReadonlySet<SkuState> = new Set<SkuState>([
  'weight_like',
  'barcode_like',
  'delimited',
  'untrusted',
]);

/** Multi-value delimiters: slash, comma, semicolon, pipe, tab, newline. */
const DELIMITER_PATTERN = /[/,;|\t\n]/;
/** A weight value entered as a SKU, e.g. `590g`, `1.5kg`, `200 ml`. */
const WEIGHT_PATTERN = /^\d+(?:\.\d+)?\s*(?:mg|kg|g|ml|l)$/i;
/** A long all-digit run (barcode/EAN-like). */
const BARCODE_PATTERN = /^\d{8,}$/;
/** A clean SKU code: alphanumeric start, then alphanumerics / `-` / `_`. */
const CLEAN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/**
 * Classify a candidate SKU. Precedence is intentional: blank → delimited →
 * weight_like → barcode_like → clean → untrusted. Weight/barcode shapes are
 * checked before `clean` because e.g. `590g` would otherwise pass as a clean
 * token. The raw value is always preserved verbatim.
 */
export function classifySku(raw: string | null | undefined): SkuClassification {
  const original = raw ?? null;
  if (raw === null || raw === undefined) {
    return { state: 'blank', raw: null, normalized: null };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { state: 'blank', raw: original, normalized: null };
  }

  let state: SkuState;
  if (DELIMITER_PATTERN.test(trimmed)) {
    state = 'delimited';
  } else if (WEIGHT_PATTERN.test(trimmed)) {
    state = 'weight_like';
  } else if (BARCODE_PATTERN.test(trimmed)) {
    state = 'barcode_like';
  } else if (CLEAN_PATTERN.test(trimmed)) {
    state = 'clean';
  } else {
    state = 'untrusted';
  }

  return { state, raw: original, normalized: trimmed };
}

/** True for any state that must be routed to review rather than trusted. */
export function isDirtySkuState(state: SkuState): boolean {
  return DIRTY_STATES.has(state);
}

/** Review actions. There is intentionally NO `'merge'`: same-SKU never merges. */
export type SkuReviewAction = 'ok' | 'review';

export type SkuReviewReason =
  /** Blank candidate — nothing to compare or review. */
  | 'blank'
  /** Clean, unique candidate. */
  | 'unique'
  /** Same SKU already exists on another product — review, never merge. */
  | 'same_sku_exists'
  /** Candidate is a dirty/ambiguous value (see SkuState) — route to review. */
  | 'dirty_value';

export interface SkuReviewDecision {
  action: SkuReviewAction;
  reason: SkuReviewReason;
  /** The matched existing SKU when `reason === 'same_sku_exists'`, else null. */
  matchedSku: string | null;
  /** The candidate's classification state. */
  state: SkuState;
}

/** Build a trimmed, blank-free comparison set from caller-supplied SKUs. */
function toComparisonSet(existingSkus: Iterable<string | null | undefined>): Set<string> {
  const set = new Set<string>();
  for (const value of existingSkus) {
    if (typeof value !== 'string') {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      set.add(trimmed);
    }
  }
  return set;
}

/**
 * Decide whether a candidate SKU is OK or must be reviewed.
 *
 * `existingSkus` is caller-supplied (a Set or any iterable of strings) — this
 * function never reads from a DB. Comparison is exact, trimmed, case-sensitive,
 * matching how SKUs are stored verbatim elsewhere.
 *
 * Precedence: blank → ok; same-SKU collision → review (never merge); dirty
 * classification → review; otherwise clean & unique → ok.
 */
export function evaluateSkuReview(
  candidate: string | null | undefined,
  existingSkus: Iterable<string | null | undefined>,
): SkuReviewDecision {
  const classification = classifySku(candidate);

  if (classification.state === 'blank') {
    return { action: 'ok', reason: 'blank', matchedSku: null, state: 'blank' };
  }

  const value = classification.normalized as string;
  const comparison = toComparisonSet(existingSkus);

  // Same SKU across products is a REVIEW signal — never an idempotency/merge key.
  if (comparison.has(value)) {
    return { action: 'review', reason: 'same_sku_exists', matchedSku: value, state: classification.state };
  }

  if (isDirtySkuState(classification.state)) {
    return { action: 'review', reason: 'dirty_value', matchedSku: null, state: classification.state };
  }

  return { action: 'ok', reason: 'unique', matchedSku: null, state: classification.state };
}
