// ---------------------------------------------------------------------------
// Phase 2A G5-C-1 — Variant sellable contract (source-only).
//
// Pure validation/projection helpers encoding the accepted G5-C semantics for
// variant-addressed selling. This module has NO I/O: no DB, no network, no
// Prisma client. It must not import from @prisma/client (domain-layer rule).
//
// Scope boundaries (deliberately enforced here as contract, not just docs):
//   - Variant sale-window semantics are STRICTLY separate from the G5-A/B
//     public calendar (`product_public_sale_window`). These helpers never read
//     or write that scope; see VARIANT_SELLABLE_ACTION_LOG_SCOPE below.
//   - No stock/order integration (G5-C-2): nothing here touches inventory,
//     OrderItem, shipments, or stock authority.
//   - Purchase limits are product-level only for Phase 2A; this module adds no
//     per-variant limit field (see VARIANT_PURCHASE_LIMIT_PLACEMENT).
// ---------------------------------------------------------------------------

/**
 * Dedicated ActionLog `metadataJson.scope` candidate for variant sellable
 * semantics. It is intentionally distinct from the G5-A/B public sale-window
 * scope so auditability of variant pricing/SKU/sale-window edits never conflates
 * with public-calendar publication. No new RBAC name is introduced — the
 * existing `product:write` permission remains the trust boundary.
 */
export const VARIANT_SELLABLE_ACTION_LOG_SCOPE = 'product_variant_sellable_contract' as const;

/**
 * Reference to the G5-A/B public-calendar audit scope, declared here only so the
 * separation can be locked by contract tests. The variant scope above must never
 * equal this value.
 */
export const PRODUCT_PUBLIC_SALE_WINDOW_ACTION_LOG_SCOPE = 'product_public_sale_window' as const;

/**
 * Purchase-limit placement marker (5.6): Phase 2A keeps purchase limits at the
 * product level only. This constant locks that decision in source; there is
 * deliberately no per-variant purchase-limit field in this contract.
 */
export const VARIANT_PURCHASE_LIMIT_PLACEMENT = 'PRODUCT_LEVEL_ONLY' as const;

/**
 * A serialized Prisma Decimal(15,4) value, matching how `priceKRW` is surfaced
 * elsewhere (e.g. ProductVariantSummary.priceKRW: string). Prices are treated as
 * opaque, authoritative absolute values: these helpers SELECT a price, they never
 * perform arithmetic on it (no rounding, no float, no summation).
 */
export type DecimalString = string;

// ---------------------------------------------------------------------------
// 5.1 — Effective SKU / barcode (inherit-at-read)
// ---------------------------------------------------------------------------

export interface VariantIdentitySource {
  variantSku?: string | null;
  variantBarcode?: string | null;
  productSku?: string | null;
  productBarcode?: string | null;
}

export interface EffectiveVariantIdentity {
  effectiveSku: string | null;
  effectiveBarcode: string | null;
  /** True when the variant's own SKU was blank/absent and the product SKU was used. */
  skuInherited: boolean;
  /** True when the variant's own barcode was blank/absent and the product barcode was used. */
  barcodeInherited: boolean;
}

/**
 * Treat null/undefined/blank-after-trim as "absent". Returns the trimmed value
 * when present, otherwise null. Whitespace-only identifiers are never persisted
 * or returned as a value.
 */
function normalizeIdentityValue(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * 5.1: `effectiveSku = variant.sku ?? product.sku` (inherit-at-read), and the
 * same for `barcode`. Inheritance is computed at read time only — nothing is
 * persisted or synthesized. Blank/whitespace variant values are treated as
 * absent and inherit the product value.
 */
export function resolveEffectiveVariantIdentity(source: VariantIdentitySource): EffectiveVariantIdentity {
  const variantSku = normalizeIdentityValue(source.variantSku);
  const productSku = normalizeIdentityValue(source.productSku);
  const variantBarcode = normalizeIdentityValue(source.variantBarcode);
  const productBarcode = normalizeIdentityValue(source.productBarcode);

  return {
    effectiveSku: variantSku ?? productSku,
    effectiveBarcode: variantBarcode ?? productBarcode,
    skuInherited: variantSku === null && productSku !== null,
    barcodeInherited: variantBarcode === null && productBarcode !== null,
  };
}

// ---------------------------------------------------------------------------
// 5.1 — Per-product non-null SKU uniqueness
// ---------------------------------------------------------------------------

export interface VariantSkuRef {
  /** Optional variant identifier, surfaced in duplicate reports for diagnostics. */
  variantId?: string;
  sku?: string | null;
}

export interface DuplicateVariantSkuGroup {
  /** The trimmed SKU value shared by more than one variant. */
  sku: string;
  /** Indexes (into the input array) of the colliding variants. */
  indexes: number[];
  /** Variant ids of the colliding variants where available. */
  variantIds: string[];
}

export class DuplicateVariantSkuError extends Error {
  readonly duplicates: DuplicateVariantSkuGroup[];

  constructor(duplicates: DuplicateVariantSkuGroup[]) {
    const skus = duplicates.map((group) => group.sku).join(', ');
    super(`Duplicate non-null variant SKUs within product: ${skus}`);
    this.name = 'DuplicateVariantSkuError';
    this.duplicates = duplicates;
  }
}

/**
 * Pure detector for per-product SKU collisions. Null/undefined/blank SKUs are
 * ignored (multiple variants may legitimately omit a SKU and inherit). Non-null
 * SKUs are compared as exact, trimmed, case-sensitive strings — no case folding
 * or normalization, matching how SKUs are stored verbatim elsewhere. Returns one
 * group per duplicated SKU; an empty array means no collisions.
 */
export function findDuplicateNonNullVariantSkus(variants: readonly VariantSkuRef[]): DuplicateVariantSkuGroup[] {
  const bySku = new Map<string, { indexes: number[]; variantIds: string[] }>();

  variants.forEach((variant, index) => {
    const sku = normalizeIdentityValue(variant.sku);
    if (sku === null) {
      return;
    }
    const entry = bySku.get(sku) ?? { indexes: [], variantIds: [] };
    entry.indexes.push(index);
    if (variant.variantId !== undefined) {
      entry.variantIds.push(variant.variantId);
    }
    bySku.set(sku, entry);
  });

  const duplicates: DuplicateVariantSkuGroup[] = [];
  for (const [sku, entry] of bySku) {
    if (entry.indexes.length > 1) {
      duplicates.push({ sku, indexes: entry.indexes, variantIds: entry.variantIds });
    }
  }
  return duplicates;
}

/**
 * 5.1: assert that, within a single product, non-null variant SKUs are unique.
 * Throws {@link DuplicateVariantSkuError} on collision; nulls/blanks are allowed
 * and never collide.
 */
export function assertUniqueNonNullVariantSkusPerProduct(variants: readonly VariantSkuRef[]): void {
  const duplicates = findDuplicateNonNullVariantSkus(variants);
  if (duplicates.length > 0) {
    throw new DuplicateVariantSkuError(duplicates);
  }
}

// ---------------------------------------------------------------------------
// 4.2 — Price authority (variant absolute vs product; delta is never summed)
// ---------------------------------------------------------------------------

export type VariantPriceAuthority = 'VARIANT' | 'PRODUCT';

export interface VariantPriceSource {
  /** Absolute authoritative variant price when the sale is variant-addressed. */
  variantPriceKRW?: DecimalString | null;
  /** Product price used when no variant price is present. */
  productPriceKRW: DecimalString;
  /**
   * Option-value price deltas (ProductOptionValue.priceDeltaKRW). These are
   * projection/derivation inputs ONLY and are never summed with an absolute
   * variant price — passing them here records them as explicitly ignored.
   */
  optionPriceDeltasKRW?: readonly number[];
}

export interface ResolvedVariantPrice {
  authority: VariantPriceAuthority;
  /** The single authoritative absolute price (never a computed sum). */
  priceKRW: DecimalString;
  /** Option deltas that were carried in but deliberately not applied. */
  ignoredOptionDeltasKRW: number[];
  /**
   * Type-level stop condition: this contract never sums delta + absolute price,
   * so this flag is always `false`. It exists to make the invariant explicit and
   * lockable in tests.
   */
  deltaSummationApplied: false;
}

/**
 * 4.2: resolve which price is authoritative for a (possibly variant-addressed)
 * sale. If a variant absolute price is present, it wins and any option deltas are
 * marked ignored (projection-only). Otherwise the product price is used. This
 * function performs NO arithmetic on prices and never adds `priceDeltaKRW` to an
 * absolute price (price double-counting stop condition).
 */
export function resolveVariantPriceAuthority(source: VariantPriceSource): ResolvedVariantPrice {
  const ignoredOptionDeltasKRW = source.optionPriceDeltasKRW ? [...source.optionPriceDeltasKRW] : [];
  // Treat null/undefined/blank-after-trim as "absent" and fall back to the
  // product price. The trim is a presence check only — the DecimalString stays
  // opaque (no parsing, no arithmetic, no normalization of the carried value).
  const hasVariantPrice =
    source.variantPriceKRW !== null &&
    source.variantPriceKRW !== undefined &&
    source.variantPriceKRW.trim().length > 0;

  return {
    authority: hasVariantPrice ? 'VARIANT' : 'PRODUCT',
    priceKRW: hasVariantPrice ? (source.variantPriceKRW as DecimalString) : source.productPriceKRW,
    ignoredOptionDeltasKRW,
    deltaSummationApplied: false,
  };
}

// ---------------------------------------------------------------------------
// 5.4 / 4.5 — Effective variant sale window (inherit / intersect / no-widen)
// ---------------------------------------------------------------------------

/**
 * A half-open `[startAt, endAt)` window in UTC. A null bound is open-ended:
 * null `startAt` means unbounded-before, null `endAt` means unbounded-after.
 */
export interface SaleWindowBounds {
  startAt: Date | null;
  endAt: Date | null;
}

export interface VariantSaleWindowSource {
  product: SaleWindowBounds;
  variant: SaleWindowBounds;
}

export interface EffectiveVariantSaleWindow {
  startAt: Date | null;
  endAt: Date | null;
  /** True when both variant bounds were null and the product window was inherited wholesale. */
  inheritedFromProduct: boolean;
  /**
   * True when the intersection is disjoint (variant window does not overlap the
   * product window), yielding no sellable interval. The contract surfaces this
   * rather than throwing, since disjoint-but-valid inputs are legitimate.
   */
  isEmpty: boolean;
}

export class InvalidSaleWindowError extends Error {
  readonly side: 'product' | 'variant';

  constructor(side: 'product' | 'variant') {
    super(`Invalid ${side} sale window: startAt must be strictly before endAt for [start, end)`);
    this.name = 'InvalidSaleWindowError';
    this.side = side;
  }
}

/** Reject a window whose bounds are both set but not strictly increasing. */
function assertValidBounds(bounds: SaleWindowBounds, side: 'product' | 'variant'): void {
  if (bounds.startAt !== null && bounds.endAt !== null && bounds.startAt.getTime() >= bounds.endAt.getTime()) {
    throw new InvalidSaleWindowError(side);
  }
}

/** Later of two start bounds; null is treated as unbounded-before (loses to any concrete time). */
function latestStart(a: Date | null, b: Date | null): Date | null {
  if (a === null) return b;
  if (b === null) return a;
  return a.getTime() >= b.getTime() ? a : b;
}

/** Earlier of two end bounds; null is treated as unbounded-after (loses to any concrete time). */
function earliestEnd(a: Date | null, b: Date | null): Date | null {
  if (a === null) return b;
  if (b === null) return a;
  return a.getTime() <= b.getTime() ? a : b;
}

/**
 * 5.4 / 4.5: resolve the effective variant sale window.
 *   - When both variant bounds are null, inherit the product window wholesale.
 *   - Otherwise intersect product ∩ variant per bound (max of starts, min of
 *     ends), treating null bounds as open-ended. Intersection guarantees the
 *     variant can NEVER widen the product window — the effective window is always
 *     contained within the product window.
 * Windows are half-open `[start, end)` in UTC; invalid inputs (start >= end with
 * both bounds set) are rejected. A disjoint intersection is reported via
 * `isEmpty` rather than throwing.
 */
export function resolveEffectiveVariantSaleWindow(source: VariantSaleWindowSource): EffectiveVariantSaleWindow {
  assertValidBounds(source.product, 'product');
  assertValidBounds(source.variant, 'variant');

  const inheritedFromProduct = source.variant.startAt === null && source.variant.endAt === null;

  const startAt = inheritedFromProduct
    ? source.product.startAt
    : latestStart(source.product.startAt, source.variant.startAt);
  const endAt = inheritedFromProduct
    ? source.product.endAt
    : earliestEnd(source.product.endAt, source.variant.endAt);

  const isEmpty = startAt !== null && endAt !== null && startAt.getTime() >= endAt.getTime();

  return { startAt, endAt, inheritedFromProduct, isEmpty };
}
