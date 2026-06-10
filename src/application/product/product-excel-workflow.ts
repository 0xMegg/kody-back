import * as XLSX from '@e965/xlsx';

import {
  dryRunImwebProductRows,
  type DryRunImwebProductRowsResult,
  type ImwebDryRunItem,
  type ImwebWarningCode,
} from './imweb-product-importer.js';
import type { ProductSaleStatus } from '@/domain/shared/types.js';

export const EXCEL_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
export const IMWEB_EXPORT_MAX_SELECTION = 500;
export const IMWEB_EXPORT_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export const IMWEB_PRODUCT_REQUIRED_HEADERS = [
  '상품번호',
  '상품명',
  '카테고리ID',
  '판매가',
  '무게',
] as const;

export const IMWEB_PRODUCT_EXPORT_HEADERS = [
  '상품번호',
  '상품명',
  '카테고리ID',
  '판매상태',
  '진열상태',
  '판매가',
  '무게',
  '원가',
  '재고사용',
  '현재 재고수량',
  '재고번호SKU',
  '원산지',
  '제조사',
  '브랜드',
  '옵션사용',
  '내보내기경고',
] as const;

export interface ProductWorkbookUploadInput {
  fileName: string;
  contentBase64: string;
  sizeBytes: number;
}

export interface ProductImportDryRunItem extends ImwebDryRunItem {
  warningCodes: ImwebWarningCode[];
  reviewRequired: boolean;
}

export interface ProductImportDryRunResult extends Omit<DryRunImwebProductRowsResult, 'items'> {
  file: {
    fileName: string;
    sizeBytes: number;
    rowCount: number;
  };
  items: ProductImportDryRunItem[];
}

export type ExportWarningCode =
  | 'MISSING_BARCODE'
  | 'MISSING_LABEL_NAME'
  | 'MISSING_RELEASE_DATE_TEXT'
  | 'MISSING_WEIGHT'
  | 'MISSING_SOURCE_CATEGORY'
  | 'ZERO_OR_MISSING_PRICE';

export interface ImwebExportProductInput {
  id: string;
  name: string;
  labelName: string | null;
  releaseDateText: string | null;
  weightG: number | null;
  priceKRW: string;
  sku: string | null;
  barcode: string | null;
  stockOnHand: number;
  stockManaged: boolean;
  saleStatus: ProductSaleStatus;
  isDisplayed: boolean;
  sourceCategoryCodes: string[];
}

export interface ImwebExportWarning {
  productId: string;
  code: ExportWarningCode;
  message: string;
}

export interface ImwebExportWorkbookResult {
  fileName: string;
  contentType: typeof IMWEB_EXPORT_CONTENT_TYPE;
  contentBase64: string;
  rowCount: number;
  warnings: ImwebExportWarning[];
}

export function parseImwebProductWorkbook(input: ProductWorkbookUploadInput): Record<string, unknown>[] {
  const buffer = validateWorkbookUpload(input);
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    cellStyles: false,
    cellFormula: false,
    cellHTML: false,
  });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error('Workbook must contain at least one sheet.');
  }

  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  const headers = readHeaderRow(sheet);
  const missing = IMWEB_PRODUCT_REQUIRED_HEADERS.filter((header) => !headers.includes(header));
  if (missing.length > 0) {
    throw new Error(`Missing required Imweb headers: ${missing.join(', ')}`);
  }
  return rows;
}

export function dryRunImwebProductWorkbookUpload(input: ProductWorkbookUploadInput): ProductImportDryRunResult {
  const rows = parseImwebProductWorkbook(input);
  const dryRun = dryRunImwebProductRows(rows);
  return {
    file: {
      fileName: input.fileName,
      sizeBytes: input.sizeBytes,
      rowCount: rows.length,
    },
    summary: dryRun.summary,
    items: dryRun.items.map((item) => ({
      ...item,
      warningCodes: item.warnings.map((warning) => warning.code),
      reviewRequired: item.warnings.some((warning) => warning.severity === 'REVIEW' || warning.severity === 'BLOCK'),
    })),
  };
}

export function buildImwebExportWorkbook(products: readonly ImwebExportProductInput[]): ImwebExportWorkbookResult {
  if (products.length > IMWEB_EXPORT_MAX_SELECTION) {
    throw new Error(`Selected product count exceeds export cap ${IMWEB_EXPORT_MAX_SELECTION}.`);
  }

  const warnings: ImwebExportWarning[] = [];
  const rows = products.map((product) => {
    const productWarnings = collectExportWarnings(product);
    warnings.push(...productWarnings);

    const row: Record<(typeof IMWEB_PRODUCT_EXPORT_HEADERS)[number], string | number> = {
      상품번호: sanitizeExcelText(product.id),
      상품명: sanitizeExcelText(product.name),
      카테고리ID: sanitizeExcelText(product.sourceCategoryCodes.join(',')),
      판매상태: sanitizeExcelText(mapSaleStatus(product.saleStatus)),
      진열상태: sanitizeExcelText(product.isDisplayed ? 'Y' : 'N'),
      판매가: formatPriceForExport(product.priceKRW),
      무게: product.weightG == null ? '' : gramsToKilograms(product.weightG),
      원가: 0,
      재고사용: sanitizeExcelText(product.stockManaged ? 'Y' : 'N'),
      '현재 재고수량': product.stockManaged ? product.stockOnHand : 0,
      재고번호SKU: sanitizeExcelText(product.sku ?? ''),
      원산지: sanitizeExcelText(product.barcode ?? ''),
      제조사: sanitizeExcelText(product.releaseDateText ?? ''),
      브랜드: sanitizeExcelText(product.labelName ?? ''),
      옵션사용: sanitizeExcelText('N'),
      내보내기경고: sanitizeExcelText(productWarnings.map((warning) => warning.code).join(',')),
    };
    return row;
  });

  const worksheet = XLSX.utils.json_to_sheet(rows, { header: [...IMWEB_PRODUCT_EXPORT_HEADERS] });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, '상품');
  if (warnings.length > 0) {
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(warnings.map((warning) => ({
        상품번호: sanitizeExcelText(warning.productId),
        경고코드: sanitizeExcelText(warning.code),
        메시지: sanitizeExcelText(warning.message),
      }))),
      '경고',
    );
  }
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return {
    fileName: `imweb-products-${new Date().toISOString().slice(0, 10)}.xlsx`,
    contentType: IMWEB_EXPORT_CONTENT_TYPE,
    contentBase64: buffer.toString('base64'),
    rowCount: products.length,
    warnings,
  };
}

function validateWorkbookUpload(input: ProductWorkbookUploadInput): Buffer {
  if (!input.fileName.toLowerCase().endsWith('.xlsx')) {
    throw new Error('Only .xlsx uploads are allowed. Macro/binary Excel formats are rejected.');
  }
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes < 0) {
    throw new Error('sizeBytes must be a non-negative integer.');
  }
  if (input.sizeBytes > EXCEL_UPLOAD_MAX_BYTES) {
    throw new Error(`Upload size ${input.sizeBytes} exceeds ${EXCEL_UPLOAD_MAX_BYTES} bytes.`);
  }

  const buffer = Buffer.from(input.contentBase64, 'base64');
  if (buffer.length !== input.sizeBytes) {
    throw new Error('Declared upload size does not match decoded workbook size.');
  }
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b || buffer[2] !== 0x03 || buffer[3] !== 0x04) {
    throw new Error('Upload is not a valid .xlsx ZIP file.');
  }
  if (buffer.includes(Buffer.from('xl/vbaProject.bin'))) {
    throw new Error('Macro-enabled workbooks are not allowed.');
  }
  return buffer;
}

function readHeaderRow(sheet: XLSX.WorkSheet): string[] {
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, blankrows: false });
  const firstRow = rows[0] ?? [];
  return firstRow.map((value) => String(value).trim()).filter(Boolean);
}

function sanitizeExcelText(value: string): string {
  if (/^[=+\-@\t\r]/.test(value)) {
    return `'${value}`;
  }
  return value;
}

function collectExportWarnings(product: ImwebExportProductInput): ImwebExportWarning[] {
  const warnings: ImwebExportWarning[] = [];
  appendWarningIf(!product.barcode, warnings, product.id, 'MISSING_BARCODE', '원산지/바코드가 비어 있어 채널 등록 전 검수가 필요합니다.');
  appendWarningIf(!product.labelName, warnings, product.id, 'MISSING_LABEL_NAME', '브랜드/기획사(labelName)가 비어 있습니다.');
  appendWarningIf(!product.releaseDateText, warnings, product.id, 'MISSING_RELEASE_DATE_TEXT', '제조사 슬롯(releaseDateText)이 비어 있습니다.');
  appendWarningIf(product.weightG == null, warnings, product.id, 'MISSING_WEIGHT', '무게가 비어 있어 Imweb kg 값을 비워 둡니다.');
  appendWarningIf(product.sourceCategoryCodes.length === 0, warnings, product.id, 'MISSING_SOURCE_CATEGORY', 'Imweb 카테고리ID sourceCategoryCodes가 비어 있습니다.');
  appendWarningIf(Number.parseFloat(product.priceKRW) <= 0, warnings, product.id, 'ZERO_OR_MISSING_PRICE', '판매가가 0원이거나 비어 있어 가격 검수가 필요합니다.');
  return warnings;
}

function appendWarningIf(condition: boolean, warnings: ImwebExportWarning[], productId: string, code: ExportWarningCode, message: string): void {
  if (condition) warnings.push({ productId, code, message });
}

function mapSaleStatus(status: ProductSaleStatus): string {
  switch (status) {
    case 'ON_SALE':
      return '판매중';
    case 'SOLD_OUT':
      return '품절';
    case 'OFF_SALE':
      return '판매중지';
    case 'DRAFT':
      return '숨김';
  }
}

function formatPriceForExport(priceKRW: string): number {
  const numeric = Number.parseFloat(priceKRW);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(4)) : 0;
}

function gramsToKilograms(weightG: number): number {
  return Number((weightG / 1000).toFixed(3));
}
