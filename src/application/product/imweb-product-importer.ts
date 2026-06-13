import type { ProductCategory } from '@/domain/shared/types.js';

export type ImwebDryRunStatus = 'create' | 'update' | 'skip' | 'conflict' | 'fail';
export type ImwebConflictReason = 'existing' | 'duplicate_in_file';
export type ImwebProductPriceStatus = 'CONFIRMED' | 'MISSING' | 'ZERO_NEEDS_REVIEW' | 'STALE_NEEDS_RECONFIRM';
export type ImwebCategoryMappingSource = 'EXACT' | 'FALLBACK' | 'MANUAL';
export type ImwebWarningCode =
  | 'CATEGORY_FALLBACK_GOODS'
  | 'DUPLICATE_BARCODE_IN_FILE'
  | 'DUPLICATE_SKU_IN_FILE'
  | 'EXISTING_BARCODE'
  | 'EXISTING_SKU'
  | 'INVALID_BARCODE_CANDIDATE'
  | 'INVALID_YN_VALUE'
  | 'MISSING_OPTION_NAME'
  | 'MISSING_OPTION_VALUES'
  | 'MISSING_PRICE'
  | 'ZERO_PRICE';
export type ImwebWarningSeverity = 'INFO' | 'WARN' | 'REVIEW' | 'BLOCK';
export type ImwebWarningDomain = 'BARCODE' | 'CATEGORY' | 'DISPLAY' | 'OPTION' | 'PRICE' | 'SKU';
export type ImwebWarningScope = 'SOURCE_DEVIATION' | 'KODY_REVIEW_REQUIRED' | 'KODY_INVARIANT_BREACH';

export interface ImwebValidationIssue {
  field: string;
  message: string;
}

export interface ImwebWarningIssue extends ImwebValidationIssue {
  code: ImwebWarningCode;
  severity: ImwebWarningSeverity;
  domain: ImwebWarningDomain;
  scope: ImwebWarningScope;
  context?: Record<string, unknown>;
}

export interface ImwebConflict {
  field: 'externalProductId' | 'sku';
  value: string;
  reason: ImwebConflictReason;
}

export interface ImwebMappedProduct {
  externalProductId: string;
  name: string;
  category: ProductCategory | null;
  artistName: string;
  releaseDateText: string | null;
  priceKRW: string;
  priceStatus: ImwebProductPriceStatus;
  sourcePriceRaw: string | null;
  weightG: number;
  sku: string | null;
  barcode: string | null;
  stockOnHand: number;
  avgPurchasePriceKRW: number;
  optionName: string | null;
  optionValues: string[];
  rawCategoryIds: string[];
  categoryMappingSource: ImwebCategoryMappingSource;
  saleStatus: string | null;
  displayStatus: boolean;
  productUrl: string | null;
  thumbnailUrl: string | null;
  detailHtml: string | null;
}

export interface ImwebDryRunItem {
  rowNumber: number;
  status: ImwebDryRunStatus;
  mapped: ImwebMappedProduct | null;
  errors: ImwebValidationIssue[];
  warnings: ImwebWarningIssue[];
  conflicts: ImwebConflict[];
}

export interface DryRunImwebProductRowsOptions {
  existingExternalProductIds?: ReadonlyMap<string, string>;
  existingSkus?: ReadonlyMap<string, string>;
  existingBarcodes?: ReadonlySet<string>;
}

export interface DryRunImwebProductRowsResult {
  summary: Record<ImwebDryRunStatus, number> & { totalRows: number };
  items: ImwebDryRunItem[];
}

const CATEGORY_BY_IMWEB_CATEGORY_ID_PREFIX: readonly [RegExp, ProductCategory][] = [
  [/CATE(?:10|14|21|44|48|64|65|70)\b/, 'ALBUM'],
  [/CATE(?:29)\b/, 'GOODS'],
];

export function parseImwebProductRow(
  row: Record<string, unknown>,
  rowNumber: number,
): ImwebDryRunItem {
  const errors: ImwebValidationIssue[] = [];
  const warnings: ImwebWarningIssue[] = [];

  const externalProductId = readRequiredString(row, '상품번호', errors);
  const name = readRequiredString(row, '상품명', errors);
  const rawCategoryIds = parseCategoryIds(readOptionalString(row, '카테고리ID'));
  const categoryMapping = mapProductCategory(rawCategoryIds, warnings);
  const category = categoryMapping.category;
  const price = readImwebPrice(row, '판매가', errors, warnings, { scale: 4 });
  const weightG = readKilogramsAsGrams(row, '무게', errors);
  const avgPurchasePriceKRW = readNonNegativeInteger(row, '원가', errors, { defaultValue: 0 });
  const sku = readOptionalString(row, '재고번호SKU') ?? readOptionalString(row, '자체 상품코드');
  const barcode = normalizeBarcode(
    readOptionalString(row, '원산지') ?? readOptionalString(row, '자체 상품코드'),
    warnings,
  );
  const artistName = readOptionalString(row, '브랜드') ?? 'UNKNOWN';
  const releaseDateText = readOptionalString(row, '제조사');
  const inventoryEnabled = parseYn(row, '재고사용', false, warnings);
  const stockOnHand = inventoryEnabled
    ? readNonNegativeInteger(row, '현재 재고수량', errors, { defaultValue: 0 })
    : 0;
  const optionEnabled = parseYn(row, '옵션사용', false, warnings);
  const optionName = optionEnabled ? readOptionalString(row, '필수옵션명') : null;
  const optionValues = optionEnabled ? parseOptionValues(readOptionalString(row, '필수옵션값')) : [];

  if (optionEnabled && !optionName) {
    warnings.push(makeWarning('MISSING_OPTION_NAME', 'WARN', 'OPTION', 'SOURCE_DEVIATION', '필수옵션명', '옵션사용=Y 이지만 필수옵션명이 비어있습니다.'));
  }
  if (optionEnabled && optionValues.length === 0) {
    warnings.push(makeWarning('MISSING_OPTION_VALUES', 'WARN', 'OPTION', 'SOURCE_DEVIATION', '필수옵션값', '옵션사용=Y 이지만 필수옵션값이 비어있습니다.'));
  }

  if (errors.length > 0) {
    return { rowNumber, status: 'fail', mapped: null, errors, warnings, conflicts: [] };
  }

  return {
    rowNumber,
    status: 'create',
    mapped: {
      externalProductId: externalProductId!,
      name: name!,
      category,
      artistName,
      releaseDateText,
      priceKRW: price!.priceKRW,
      priceStatus: price!.priceStatus,
      sourcePriceRaw: price!.sourcePriceRaw,
      weightG: weightG!,
      sku,
      barcode,
      stockOnHand: stockOnHand!,
      avgPurchasePriceKRW: avgPurchasePriceKRW!,
      optionName,
      optionValues,
      rawCategoryIds,
      categoryMappingSource: categoryMapping.source,
      saleStatus: readOptionalString(row, '판매상태'),
      displayStatus: parseYn(row, '진열상태', false, warnings),
      productUrl: readOptionalString(row, '상품URL'),
      thumbnailUrl: readOptionalString(row, '대표이미지URL'),
      detailHtml: readOptionalString(row, '상품상세정보'),
    },
    errors,
    warnings,
    conflicts: [],
  };
}

export function dryRunImwebProductRows(
  rows: readonly Record<string, unknown>[],
  options: DryRunImwebProductRowsOptions = {},
): DryRunImwebProductRowsResult {
  const seenExternalProductIds = new Set<string>();
  const seenSkus = new Set<string>();
  const seenBarcodes = new Set<string>();
  const items = rows.map((row, index) => {
    const item = parseImwebProductRow(row, index + 2);
    if (!item.mapped) {
      return item;
    }

    const conflicts: ImwebConflict[] = [];
    appendExternalProductIdConflict(
      conflicts,
      item.mapped.externalProductId,
      seenExternalProductIds,
    );

    const matchedProductId =
      options.existingExternalProductIds?.get(item.mapped.externalProductId) ?? null;

    appendSkuChecks(
      item.warnings,
      conflicts,
      item.mapped.sku,
      seenSkus,
      options.existingSkus,
      matchedProductId,
    );
    appendBarcodeWarnings(
      item.warnings,
      item.mapped.barcode,
      seenBarcodes,
      options.existingBarcodes,
    );

    seenExternalProductIds.add(item.mapped.externalProductId);
    if (item.mapped.sku) seenSkus.add(item.mapped.sku);
    if (item.mapped.barcode) seenBarcodes.add(item.mapped.barcode);

    if (conflicts.length > 0) {
      return { ...item, status: 'conflict' as const, conflicts };
    }

    const status = options.existingExternalProductIds?.has(item.mapped.externalProductId)
      ? 'update'
      : item.status;
    return { ...item, status };
  });

  return {
    summary: summarize(items),
    items,
  };
}

function readRequiredString(
  row: Record<string, unknown>,
  field: string,
  errors: ImwebValidationIssue[],
): string | null {
  const value = readOptionalString(row, field);
  if (!value) {
    errors.push({ field, message: `${field}${subjectParticle(field)} 비어있습니다.` });
    return null;
  }
  return value;
}

function readOptionalString(row: Record<string, unknown>, field: string): string | null {
  const value = row[field];
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readNonNegativeInteger(
  row: Record<string, unknown>,
  field: string,
  errors: ImwebValidationIssue[],
  options: { defaultValue?: number } = {},
): number | null {
  const value = row[field];
  if ((value == null || value === '') && options.defaultValue !== undefined) {
    return options.defaultValue;
  }
  const numeric = parseNumericCell(value);
  if (!Number.isInteger(numeric) || numeric < 0) {
    errors.push({ field, message: `${field}가 0 이상의 정수여야 합니다.` });
    return null;
  }
  return numeric;
}

function readNonNegativeDecimal(
  row: Record<string, unknown>,
  field: string,
  errors: ImwebValidationIssue[],
  options: { scale: number },
): string | null {
  const raw = row[field];
  const normalized = normalizeDecimalCell(raw);
  if (!normalized) {
    errors.push({ field, message: `${field}가 0 이상의 소수여야 합니다.` });
    return null;
  }

  const [integerPart, fractionalPart = ''] = normalized.split('.');
  if (fractionalPart.length > options.scale) {
    errors.push({ field, message: `${field}가 소수점 ${options.scale}자리 이하여야 합니다.` });
    return null;
  }

  return `${integerPart}.${fractionalPart.padEnd(options.scale, '0')}`;
}

function readImwebPrice(
  row: Record<string, unknown>,
  field: string,
  errors: ImwebValidationIssue[],
  warnings: ImwebWarningIssue[],
  options: { scale: number },
): { priceKRW: string; priceStatus: ImwebProductPriceStatus; sourcePriceRaw: string | null } | null {
  const sourcePriceRaw = readRawCell(row[field]);
  const normalized = normalizeDecimalCell(row[field]);
  if (!normalized) {
    if (sourcePriceRaw === '가격없음') {
      warnings.push(makeWarning('MISSING_PRICE', 'REVIEW', 'PRICE', 'KODY_REVIEW_REQUIRED', field, `${field}가 가격없음이므로 가격 검수 필요 상태로 등록합니다.`, { sourcePriceRaw }));
      return { priceKRW: zeroDecimal(options.scale), priceStatus: 'MISSING', sourcePriceRaw };
    }
    errors.push({ field, message: `${field}가 0 이상의 소수여야 합니다.` });
    return null;
  }

  const [integerPart, fractionalPart = ''] = normalized.split('.');
  if (fractionalPart.length > options.scale) {
    errors.push({ field, message: `${field}가 소수점 ${options.scale}자리 이하여야 합니다.` });
    return null;
  }

  const priceKRW = `${integerPart}.${fractionalPart.padEnd(options.scale, '0')}`;
  if (isZeroDecimal(priceKRW)) {
    warnings.push(makeWarning('ZERO_PRICE', 'REVIEW', 'PRICE', 'KODY_REVIEW_REQUIRED', field, `${field}가 0원이므로 가격 검수 필요 상태로 등록합니다.`, { sourcePriceRaw, priceKRW }));
    return { priceKRW, priceStatus: 'ZERO_NEEDS_REVIEW', sourcePriceRaw };
  }

  return { priceKRW, priceStatus: 'CONFIRMED', sourcePriceRaw };
}

function readRawCell(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function zeroDecimal(scale: number): string {
  return `0.${''.padEnd(scale, '0')}`;
}

function isZeroDecimal(value: string): boolean {
  return Number(value) === 0;
}

function readKilogramsAsGrams(
  row: Record<string, unknown>,
  field: string,
  errors: ImwebValidationIssue[],
): number | null {
  const raw = row[field];
  const normalized = normalizeDecimalCell(raw);
  if (!normalized) {
    errors.push({ field, message: `${field}가 0 이상의 kg 숫자여야 합니다.` });
    return null;
  }

  const kg = Number(normalized);
  const grams = Math.round(kg * 1000);
  if (!Number.isSafeInteger(grams) || grams < 0) {
    errors.push({ field, message: `${field}를 gram 정수로 변환할 수 없습니다.` });
    return null;
  }
  return grams;
}

function parseNumericCell(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value.replace(/,/g, '').trim());
  return Number.NaN;
}

function normalizeDecimalCell(value: unknown): string | null {
  const raw = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.replace(/,/g, '').trim() : '';
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw)) return null;
  return raw;
}

function parseCategoryIds(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function mapProductCategory(
  categoryIds: readonly string[],
  warnings: ImwebWarningIssue[],
): { category: ProductCategory | null; source: ImwebCategoryMappingSource } {
  const joined = categoryIds.join(',');
  for (const [pattern, category] of CATEGORY_BY_IMWEB_CATEGORY_ID_PREFIX) {
    if (pattern.test(joined)) return { category, source: 'EXACT' };
  }
  warnings.push(makeWarning(
    'CATEGORY_FALLBACK_GOODS',
    'WARN',
    'CATEGORY',
    'SOURCE_DEVIATION',
    '카테고리ID',
    'KODY 상품 카테고리로 명확히 매핑되지 않아 category=null 검수 대상으로 dry-run 처리합니다.',
    { rawCategoryIds: categoryIds, assignedCategory: null },
  ));
  return { category: null, source: 'FALLBACK' };
}

function normalizeBarcode(
  value: string | null,
  warnings: ImwebWarningIssue[],
): string | null {
  if (!value) return null;
  const normalized = value.replace(/[\s-]/g, '');
  if (!/^\d{8,14}$/.test(normalized)) {
    warnings.push(makeWarning('INVALID_BARCODE_CANDIDATE', 'WARN', 'BARCODE', 'SOURCE_DEVIATION', '원산지', '바코드 후보가 EAN/UPC 숫자 형식이 아닙니다.', { value }));
    return value;
  }
  return normalized;
}

function parseYn(
  row: Record<string, unknown>,
  field: string,
  defaultValue: boolean,
  warnings: ImwebWarningIssue[],
): boolean {
  const value = readOptionalString(row, field);
  if (value === 'Y') return true;
  if (value === 'N') return false;
  if (value != null) {
    warnings.push(makeWarning('INVALID_YN_VALUE', 'INFO', 'DISPLAY', 'SOURCE_DEVIATION', field, `${field} 값이 Y/N이 아니어서 기본값으로 처리합니다.`, { value }));
  }
  return defaultValue;
}

function parseOptionValues(value: string | null): string[] {
  if (!value) return [];
  const seen = new Set<string>();
  const values: string[] = [];
  for (const part of value.split(',')) {
    const normalized = part.trim().replace(/\s+/g, ' ');
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    values.push(normalized);
  }
  return values;
}

function appendExternalProductIdConflict(
  conflicts: ImwebConflict[],
  value: string,
  seen: ReadonlySet<string>,
): void {
  if (seen.has(value)) {
    conflicts.push({ field: 'externalProductId', value, reason: 'duplicate_in_file' });
  }
}

function appendSkuChecks(
  warnings: ImwebWarningIssue[],
  conflicts: ImwebConflict[],
  value: string | null,
  seenInFile: ReadonlySet<string>,
  existing: ReadonlyMap<string, string> | undefined,
  matchedProductId: string | null,
): void {
  if (!value) return;
  const existingOwnerProductId = existing?.get(value);
  if (existingOwnerProductId) {
    warnings.push(makeWarning(
      'EXISTING_SKU',
      'WARN',
      'SKU',
      'SOURCE_DEVIATION',
      'sku',
      existingOwnerProductId === matchedProductId
        ? '이미 존재하는 SKU입니다. 검색 보조값으로만 유지합니다.'
        : '이미 존재하는 SKU입니다. SKU는 고유해야 합니다.',
      { value, ownerProductId: existingOwnerProductId },
    ));
    if (existingOwnerProductId !== matchedProductId) {
      conflicts.push({ field: 'sku', value, reason: 'existing' });
    }
  }
  if (seenInFile.has(value)) {
    warnings.push(makeWarning(
      'DUPLICATE_SKU_IN_FILE',
      'WARN',
      'SKU',
      'SOURCE_DEVIATION',
      'sku',
      '파일 안에서 중복된 SKU입니다. SKU는 고유해야 합니다.',
      { value },
    ));
    conflicts.push({ field: 'sku', value, reason: 'duplicate_in_file' });
  }
}

function appendBarcodeWarnings(
  warnings: ImwebWarningIssue[],
  value: string | null,
  seenInFile: ReadonlySet<string>,
  existing: ReadonlySet<string> | undefined,
): void {
  if (!value) return;
  if (existing?.has(value)) {
    warnings.push(makeWarning(
      'EXISTING_BARCODE',
      'WARN',
      'BARCODE',
      'SOURCE_DEVIATION',
      'barcode',
      '이미 존재하는 바코드입니다. 검색 보조값으로만 유지합니다.',
      { value },
    ));
  }
  if (seenInFile.has(value)) {
    warnings.push(makeWarning(
      'DUPLICATE_BARCODE_IN_FILE',
      'WARN',
      'BARCODE',
      'SOURCE_DEVIATION',
      'barcode',
      '파일 안에서 중복된 바코드입니다. 검색 보조값으로만 유지합니다.',
      { value },
    ));
  }
}

function makeWarning(
  code: ImwebWarningCode,
  severity: ImwebWarningSeverity,
  domain: ImwebWarningDomain,
  scope: ImwebWarningScope,
  field: string,
  message: string,
  context?: Record<string, unknown>,
): ImwebWarningIssue {
  return context ? { code, severity, domain, scope, field, message, context } : { code, severity, domain, scope, field, message };
}

function summarize(items: readonly ImwebDryRunItem[]): DryRunImwebProductRowsResult['summary'] {
  const summary = { totalRows: items.length, create: 0, update: 0, skip: 0, conflict: 0, fail: 0 };
  for (const item of items) {
    summary[item.status] += 1;
  }
  return summary;
}

function subjectParticle(value: string): '이' | '가' {
  const last = value.charCodeAt(value.length - 1);
  if (last < 0xac00 || last > 0xd7a3) return '가';
  return (last - 0xac00) % 28 === 0 ? '가' : '이';
}
