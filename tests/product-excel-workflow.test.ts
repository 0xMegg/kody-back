import { describe, expect, it } from 'vitest';
import * as XLSX from '@e965/xlsx';

import {
  buildImwebExportWorkbook,
  dryRunImwebProductWorkbookUpload,
  EXCEL_UPLOAD_MAX_BYTES,
  parseImwebProductWorkbook,
} from '@/application/product/product-excel-workflow.js';

function workbookBase64(rows: Record<string, unknown>[]): string {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), '상품');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return buffer.toString('base64');
}

function validImwebRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    상품번호: '6571',
    상품명: 'ILLIT - Album',
    카테고리ID: 'CATE70,CATE65',
    판매가: '17440',
    무게: '1',
    원가: '0',
    재고사용: 'Y',
    '현재 재고수량': '14',
    재고번호SKU: 'YP0885',
    원산지: '8809704435086',
    제조사: '2026-04-30',
    브랜드: 'BELIFT LAB',
    옵션사용: 'N',
    진열상태: 'Y',
    판매상태: '판매중',
    ...overrides,
  };
}

describe('product Excel workflow', () => {
  it('parses an .xlsx upload into importer dry-run rows with warning codes and reviewRequired', () => {
    const contentBase64 = workbookBase64([
      validImwebRow({ 상품번호: '6571', 카테고리ID: 'CATE999' }),
      validImwebRow({ 상품번호: '6572', 판매가: '가격없음' }),
    ]);

    const result = dryRunImwebProductWorkbookUpload({
      fileName: 'imweb-products.xlsx',
      contentBase64,
      sizeBytes: Buffer.byteLength(contentBase64, 'base64'),
    });

    expect(result.summary).toEqual({ totalRows: 2, create: 2, update: 0, skip: 0, conflict: 0, fail: 0 });
    expect(result.items[0].warningCodes).toContain('CATEGORY_FALLBACK_GOODS');
    expect(result.items[1].warningCodes).toContain('MISSING_PRICE');
    expect(result.items[1].reviewRequired).toBe(true);
  });

  it('rejects missing required Imweb headers before dry-run', () => {
    const contentBase64 = workbookBase64([{ 상품번호: '6571', 상품명: 'No price' }]);

    expect(() => parseImwebProductWorkbook({
      fileName: 'missing-headers.xlsx',
      contentBase64,
      sizeBytes: Buffer.byteLength(contentBase64, 'base64'),
    })).toThrow(/Missing required Imweb headers: 카테고리ID, 판매가, 무게/);
  });

  it('rejects forbidden extensions, non-zip payloads, VBA macro markers, and oversized payload declarations', () => {
    const contentBase64 = Buffer.from('not a zip file').toString('base64');

    expect(() => parseImwebProductWorkbook({ fileName: 'bad.xlsm', contentBase64, sizeBytes: 14 })).toThrow(/Only .xlsx uploads are allowed/);
    expect(() => parseImwebProductWorkbook({ fileName: 'bad.xlsx', contentBase64, sizeBytes: 14 })).toThrow(/valid .xlsx ZIP file/);

    const macroMarked = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('xl/vbaProject.bin')]);
    expect(() => parseImwebProductWorkbook({ fileName: 'macro.xlsx', contentBase64: macroMarked.toString('base64'), sizeBytes: macroMarked.length })).toThrow(/Macro-enabled workbooks are not allowed/);

    expect(() => parseImwebProductWorkbook({ fileName: 'huge.xlsx', contentBase64, sizeBytes: EXCEL_UPLOAD_MAX_BYTES + 1 })).toThrow(/exceeds/);
  });

  it('builds deterministic Imweb export workbook with warnings for unsafe values', () => {
    const result = buildImwebExportWorkbook([
      {
        id: 'KODY-PROD-000001',
        name: 'Album A',
        labelName: 'BELIFT LAB',
        releaseDateText: '2026-04-30',
        weightG: 65,
        priceKRW: '17440.0000',
        sku: 'YP0885',
        barcode: '8809704435086',
        stockOnHand: 14,
        stockManaged: true,
        saleStatus: 'ON_SALE',
        isDisplayed: true,
        sourceCategoryCodes: ['CATE70', 'CATE65'],
      },
      {
        id: 'KODY-PROD-000002',
        name: 'Unsafe Product',
        labelName: null,
        releaseDateText: null,
        weightG: null,
        priceKRW: '0.0000',
        sku: null,
        barcode: null,
        stockOnHand: 0,
        stockManaged: false,
        saleStatus: 'DRAFT',
        isDisplayed: false,
        sourceCategoryCodes: [],
      },
    ]);

    expect(result.rowCount).toBe(2);
    expect(result.warnings).toContainEqual(expect.objectContaining({ productId: 'KODY-PROD-000002', code: 'MISSING_BARCODE' }));
    expect(result.warnings).toContainEqual(expect.objectContaining({ productId: 'KODY-PROD-000002', code: 'MISSING_SOURCE_CATEGORY' }));

    const workbook = XLSX.read(Buffer.from(result.contentBase64, 'base64'), { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['상품'], { defval: '' });
    expect(Object.keys(rows[0])).toEqual([
      '상품번호', '상품명', '카테고리ID', '판매상태', '진열상태', '판매가', '무게', '원가',
      '재고사용', '현재 재고수량', '재고번호SKU', '원산지', '제조사', '브랜드', '옵션사용', '내보내기경고',
    ]);
    expect(rows[0]).toMatchObject({ 상품번호: 'KODY-PROD-000001', 무게: 0.065, 원산지: '8809704435086', 브랜드: 'BELIFT LAB' });
    expect(String(rows[1].내보내기경고)).toContain('MISSING_BARCODE');
  });

  it('escapes formula-leading text cells in Imweb export workbooks', () => {
    const result = buildImwebExportWorkbook([
      {
        id: '=KODY-PROD-000003',
        name: '=cmd|\'/c calc\'!A1',
        labelName: '@brand',
        releaseDateText: '+manufacturer',
        weightG: 100,
        priceKRW: '1000.0000',
        sku: '-sku',
        barcode: '\tbarcode',
        stockOnHand: 1,
        stockManaged: true,
        saleStatus: 'ON_SALE',
        isDisplayed: true,
        sourceCategoryCodes: ['=CATE'],
      },
    ]);

    const workbook = XLSX.read(Buffer.from(result.contentBase64, 'base64'), { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['상품'], { defval: '' });

    expect(rows[0].상품번호).toBe("'=KODY-PROD-000003");
    expect(rows[0].상품명).toBe("'=cmd|'/c calc'!A1");
    expect(rows[0].카테고리ID).toBe("'=CATE");
    expect(rows[0].재고번호SKU).toBe("'-sku");
    expect(rows[0].원산지).toBe("'\tbarcode");
    expect(rows[0].제조사).toBe("'+manufacturer");
    expect(rows[0].브랜드).toBe("'@brand");
  });
});
