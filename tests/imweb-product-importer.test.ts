import { describe, expect, it } from 'vitest';

import {
  dryRunImwebProductRows,
  parseImwebProductRow,
} from '@/application/product/imweb-product-importer.js';

function validRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    상품번호: '6571',
    상품명: '(LUCKY DRAW) ILLIT - 4th Mini Album [MAMIHLAPINATAPAI]',
    '자체 상품코드': '',
    카테고리ID: 'CATE70,CATE65',
    판매상태: '판매중',
    상품상태: '신상품',
    진열상태: 'Y',
    판매가: '17440',
    무게: '1',
    정가: '',
    원가: '0',
    재고사용: 'Y',
    '현재 재고수량': '14',
    재고번호SKU: 'YP0885',
    상품상세정보: '',
    상품URL: 'https://kodyglobalkr.imweb.me/63/?idx=6571',
    대표이미지URL: 'https://cdn.imweb.me/thumbnail/20260519/524b0c5e22bb422e.png',
    세금: '과세상품',
    '미성년자 구매': 'Y',
    개인통관고유부호: '기본 방법을 따름 (쇼핑 환경설정)',
    원산지: '8809704435086',
    제조사: '2026-04-30',
    브랜드: 'BELIFT LAB',
    옵션사용: 'Y',
    옵션형태: '단독형',
    필수옵션명: 'VERSION',
    필수옵션값: 'MUSIC PLANET,KTOWN4U',
    필수옵션재고수량합계: '14',
    ...overrides,
  };
}

describe('Imweb product dry-run importer', () => {
  it('maps a real Imweb export row to KODY Product dry-run fields without DB writes', () => {
    const result = parseImwebProductRow(validRow(), 2);

    expect(result.status).toBe('create');
    expect(result.errors).toEqual([]);
    expect(result.mapped).toMatchObject({
      externalProductId: '6571',
      name: '(LUCKY DRAW) ILLIT - 4th Mini Album [MAMIHLAPINATAPAI]',
      category: 'ALBUM',
      artistName: 'BELIFT LAB',
      priceKRW: '17440.0000',
      weightG: 1000,
      sku: 'YP0885',
      barcode: '8809704435086',
      stockOnHand: 14,
      avgPurchasePriceKRW: 0,
      optionName: 'VERSION',
      optionValues: ['MUSIC PLANET', 'KTOWN4U'],
    });
    expect(result.mapped?.rawCategoryIds).toEqual(['CATE70', 'CATE65']);
  });

  it('preserves Imweb decimal sales prices and converts kg weight to gram integers', () => {
    const result = parseImwebProductRow(validRow({ 판매가: '47637.5693', 무게: '0.065' }), 801);

    expect(result.status).toBe('create');
    expect(result.errors).toEqual([]);
    expect(result.mapped?.priceKRW).toBe('47637.5693');
    expect(result.mapped?.weightG).toBe(65);
    expect(result.mapped?.priceStatus).toBe('CONFIRMED');
    expect(result.mapped?.sourcePriceRaw).toBe('47637.5693');
  });

  it('registers non-numeric Imweb prices as missing-price review instead of failing the row', () => {
    const result = parseImwebProductRow(validRow({ 판매가: '가격없음', 판매상태: '숨김' }), 4925);

    expect(result.status).toBe('create');
    expect(result.errors).toEqual([]);
    expect(result.mapped).toMatchObject({
      priceKRW: '0.0000',
      priceStatus: 'MISSING',
      sourcePriceRaw: '가격없음',
    });
    expect(result.warnings).toContainEqual(expect.objectContaining({
      code: 'MISSING_PRICE',
      severity: 'REVIEW',
      domain: 'PRICE',
      scope: 'KODY_REVIEW_REQUIRED',
      field: '판매가',
      message: '판매가가 가격없음이므로 가격 검수 필요 상태로 등록합니다.',
    }));
  });

  it('registers explicit zero Imweb prices as zero-price review instead of confirmed', () => {
    const result = parseImwebProductRow(validRow({ 판매가: 0, 판매상태: '숨김' }), 21);

    expect(result.status).toBe('create');
    expect(result.errors).toEqual([]);
    expect(result.mapped).toMatchObject({
      priceKRW: '0.0000',
      priceStatus: 'ZERO_NEEDS_REVIEW',
      sourcePriceRaw: '0',
    });
    expect(result.warnings).toContainEqual(expect.objectContaining({
      code: 'ZERO_PRICE',
      severity: 'REVIEW',
      domain: 'PRICE',
      scope: 'KODY_REVIEW_REQUIRED',
      field: '판매가',
      message: '판매가가 0원이므로 가격 검수 필요 상태로 등록합니다.',
    }));
  });



  it('persists category fallback provenance as a structured warning without failing the row', () => {
    const result = parseImwebProductRow(validRow({ 카테고리ID: 'CATE999' }), 42);

    expect(result.status).toBe('create');
    expect(result.errors).toEqual([]);
    expect(result.mapped).toMatchObject({
      category: 'GOODS',
      rawCategoryIds: ['CATE999'],
      categoryMappingSource: 'FALLBACK',
    });
    expect(result.warnings).toContainEqual(expect.objectContaining({
      code: 'CATEGORY_FALLBACK_GOODS',
      severity: 'WARN',
      domain: 'CATEGORY',
      scope: 'SOURCE_DEVIATION',
      field: '카테고리ID',
    }));
  });

  it('fails rows with missing required values or invalid numeric fields', () => {
    const result = parseImwebProductRow(
      validRow({ 상품번호: '', 상품명: '', 판매가: 'not-a-number', 무게: '-1' }),
      7,
    );

    expect(result.status).toBe('fail');
    expect(result.rowNumber).toBe(7);
    expect(result.mapped).toBeNull();
    expect(result.errors).toEqual(
      expect.arrayContaining([
        { field: '상품번호', message: '상품번호가 비어있습니다.' },
        { field: '상품명', message: '상품명이 비어있습니다.' },
        { field: '판매가', message: '판매가가 0 이상의 소수여야 합니다.' },
        { field: '무게', message: '무게가 0 이상의 kg 숫자여야 합니다.' },
      ]),
    );
  });

  it('treats duplicate SKU/barcode as warnings, not identity conflicts', () => {
    const results = dryRunImwebProductRows(
      [
        validRow({ 상품번호: '6571', 재고번호SKU: 'YP0885', 원산지: '8809704435086' }),
        validRow({ 상품번호: '6572', 재고번호SKU: 'YP0885', 원산지: '8809704435999' }),
        validRow({ 상품번호: '6573', 재고번호SKU: 'YP9999', 원산지: '8809704435086' }),
      ],
      {
        existingSkus: new Set(['YP9999']),
        existingBarcodes: new Set(['8809704435086']),
      },
    );

    expect(results.summary).toEqual({ totalRows: 3, create: 3, update: 0, skip: 0, conflict: 0, fail: 0 });
    expect(results.items.every((item) => item.status === 'create')).toBe(true);
    expect(results.items[0].warnings).toContainEqual(expect.objectContaining({ code: 'EXISTING_BARCODE', field: 'barcode', message: '이미 존재하는 바코드입니다. 검색 보조값으로만 유지합니다.' }));
    expect(results.items[1].warnings).toContainEqual(expect.objectContaining({ code: 'DUPLICATE_SKU_IN_FILE', field: 'sku', message: '파일 안에서 중복된 SKU입니다. 검색 보조값으로만 유지합니다.' }));
    expect(results.items[2].warnings).toContainEqual(expect.objectContaining({ code: 'EXISTING_SKU', field: 'sku', message: '이미 존재하는 SKU입니다. 검색 보조값으로만 유지합니다.' }));
  });

  it('uses source external product ID for update identity and duplicate-file conflicts', () => {
    const results = dryRunImwebProductRows(
      [
        validRow({ 상품번호: '6571' }),
        validRow({ 상품번호: '6572' }),
        validRow({ 상품번호: '6572' }),
      ],
      { existingExternalProductIds: new Set(['6571']) },
    );

    expect(results.summary).toEqual({ totalRows: 3, create: 1, update: 1, skip: 0, conflict: 1, fail: 0 });
    expect(results.items[0].status).toBe('update');
    expect(results.items[1].status).toBe('create');
    expect(results.items[2].status).toBe('conflict');
    expect(results.items[2].conflicts).toContainEqual({
      field: 'externalProductId',
      value: '6572',
      reason: 'duplicate_in_file',
    });
  });
});
