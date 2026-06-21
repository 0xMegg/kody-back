import { describe, expect, it } from 'vitest';

import {
  dryRunImwebProductRows,
  parseImwebProductRow,
  parseReleaseDate,
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

  it('parses releaseDateText only for whitelisted safe date formats', () => {
    expect(parseReleaseDate('2026-04-30')?.toISOString()).toBe('2026-04-30T00:00:00.000Z');
    expect(parseReleaseDate('2026.04.30')?.toISOString()).toBe('2026-04-30T00:00:00.000Z');
    expect(parseReleaseDate('2026/04/30')?.toISOString()).toBe('2026-04-30T00:00:00.000Z');
    expect(parseReleaseDate('2026년 4월 30일')?.toISOString()).toBe('2026-04-30T00:00:00.000Z');
    expect(parseReleaseDate('2026-04')?.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(parseReleaseDate('2026.04')?.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(parseReleaseDate('2026')?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(parseReleaseDate('2026-02-30')).toBeNull();
    expect(parseReleaseDate('2026년 봄')).toBeNull();
    expect(parseReleaseDate('S/S 24')).toBeNull();
  });

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
      releaseDateText: '2026-04-30',
      releaseDate: new Date('2026-04-30T00:00:00.000Z'),
    });
    expect(result.mapped?.rawCategoryIds).toEqual(['CATE70', 'CATE65']);
  });

  it('preserves approved Imweb manufacturer-column remapping as releaseDateText and keeps unsafe dates nullable', () => {
    const result = parseImwebProductRow(validRow({ 제조사: 'BELIFT manufacturer memo' }), 9);

    expect(result.status).toBe('create');
    expect(result.errors).toEqual([]);
    expect(result.mapped).toMatchObject({
      artistName: 'BELIFT LAB',
      releaseDateText: 'BELIFT manufacturer memo',
      releaseDate: null,
    });
  });

  it('deduplicates required option display values without creating variant stock semantics', () => {
    const result = parseImwebProductRow(
      validRow({ 필수옵션명: 'VERSION', 필수옵션값: ' MUSIC PLANET ,KTOWN4U, MUSIC   PLANET , ' }),
      10,
    );

    expect(result.status).toBe('create');
    expect(result.errors).toEqual([]);
    expect(result.mapped?.optionName).toBe('VERSION');
    expect(result.mapped?.optionValues).toEqual(['MUSIC PLANET', 'KTOWN4U']);
    expect(result.mapped).not.toHaveProperty('variantId');
    expect(result.mapped).not.toHaveProperty('optionStockOnHand');
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

  it('preserves invalid barcode candidates as source evidence while warning instead of blocking', () => {
    const result = parseImwebProductRow(validRow({ 원산지: 'MADE-IN-KOREA' }), 802);

    expect(result.status).toBe('create');
    expect(result.errors).toEqual([]);
    expect(result.mapped?.barcode).toBe('MADE-IN-KOREA');
    expect(result.warnings).toContainEqual(expect.objectContaining({
      code: 'INVALID_BARCODE_CANDIDATE',
      severity: 'WARN',
      domain: 'BARCODE',
      scope: 'SOURCE_DEVIATION',
      field: '원산지',
      context: { value: 'MADE-IN-KOREA' },
    }));
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



  it('persists unmapped category provenance as review-required debt without failing the row', () => {
    const result = parseImwebProductRow(validRow({ 카테고리ID: 'CATE999' }), 42);

    expect(result.status).toBe('create');
    expect(result.errors).toEqual([]);
    expect(result.mapped).toMatchObject({
      category: null,
      rawCategoryIds: ['CATE999'],
      categoryMappingSource: 'FALLBACK',
    });
    expect(result.warnings).toContainEqual(expect.objectContaining({
      code: 'CATEGORY_UNMAPPED',
      severity: 'REVIEW',
      domain: 'CATEGORY',
      scope: 'KODY_REVIEW_REQUIRED',
      field: '카테고리ID',
    }));
  });

  it('keeps option-use source deviations as warning evidence without creating variant semantics', () => {
    const result = parseImwebProductRow(
      validRow({ 옵션사용: 'Y', 필수옵션명: '', 필수옵션값: '' }),
      43,
    );

    expect(result.status).toBe('create');
    expect(result.errors).toEqual([]);
    expect(result.mapped?.optionName).toBeNull();
    expect(result.mapped?.optionValues).toEqual([]);
    expect(result.mapped).not.toHaveProperty('variantId');
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'MISSING_OPTION_NAME', domain: 'OPTION', scope: 'SOURCE_DEVIATION' }),
      expect.objectContaining({ code: 'MISSING_OPTION_VALUES', domain: 'OPTION', scope: 'SOURCE_DEVIATION' }),
    ]));
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

  it('treats duplicate SKU as hard conflict and duplicate barcode as non-blocking warning', () => {
    const results = dryRunImwebProductRows(
      [
        validRow({ 상품번호: '6571', 재고번호SKU: 'YP0885', 원산지: '8809704435086' }),
        validRow({ 상품번호: '6572', 재고번호SKU: 'YP0885', 원산지: '8809704435999' }),
        validRow({ 상품번호: '6573', 재고번호SKU: 'YP9999', 원산지: '8809704435086' }),
      ],
      {
        existingSkus: new Map([['YP9999', 'KODY-PROD-000099']]),
        existingBarcodes: new Set(['8809704435086']),
      },
    );

    expect(results.summary).toEqual({ totalRows: 3, create: 1, update: 0, skip: 0, conflict: 2, fail: 0 });
    expect(results.items[0].status).toBe('create');
    expect(results.items[0].warnings).toContainEqual(expect.objectContaining({ code: 'EXISTING_BARCODE', field: 'barcode', message: '이미 존재하는 바코드입니다. 검색 보조값으로만 유지합니다.' }));
    expect(results.items[0].conflicts).toEqual([]);

    expect(results.items[1].status).toBe('conflict');
    expect(results.items[1].warnings).toContainEqual(expect.objectContaining({ code: 'DUPLICATE_SKU_IN_FILE', field: 'sku', message: '파일 안에서 중복된 SKU입니다. SKU는 고유해야 합니다.' }));
    expect(results.items[1].conflicts).toContainEqual({ field: 'sku', value: 'YP0885', reason: 'duplicate_in_file' });

    expect(results.items[2].status).toBe('conflict');
    expect(results.items[2].warnings).toContainEqual(expect.objectContaining({ code: 'EXISTING_SKU', field: 'sku', message: '이미 존재하는 SKU입니다. SKU는 고유해야 합니다.' }));
    expect(results.items[2].warnings).toContainEqual(expect.objectContaining({ code: 'DUPLICATE_BARCODE_IN_FILE', field: 'barcode', message: '파일 안에서 중복된 바코드입니다. 검색 보조값으로만 유지합니다.' }));
    expect(results.items[2].conflicts).toContainEqual({ field: 'sku', value: 'YP9999', reason: 'existing' });
  });

  it('treats SKU collision with the same OMS product as a non-blocking warning during update', () => {
    const results = dryRunImwebProductRows(
      [validRow({ 상품번호: '6571', 재고번호SKU: 'YP0885', 원산지: '8809704435086' })],
      {
        existingExternalProductIds: new Map([['6571', 'KODY-PROD-000099']]),
        existingSkus: new Map([['YP0885', 'KODY-PROD-000099']]),
        existingBarcodes: new Set(['8809704435086']),
      },
    );

    expect(results.summary).toEqual({ totalRows: 1, create: 0, update: 1, skip: 0, conflict: 0, fail: 0 });
    expect(results.items[0].status).toBe('update');
    expect(results.items[0].conflicts).toEqual([]);
    expect(results.items[0].warnings).toContainEqual(expect.objectContaining({ code: 'EXISTING_SKU', field: 'sku' }));
    expect(results.items[0].warnings).toContainEqual(expect.objectContaining({ code: 'EXISTING_BARCODE', field: 'barcode' }));
  });

  it('uses source external product ID for update identity and duplicate-file conflicts', () => {
    const results = dryRunImwebProductRows(
      [
        validRow({ 상품번호: '6571', 재고번호SKU: 'YP0001', 원산지: '8809000000001' }),
        validRow({ 상품번호: '6572', 재고번호SKU: 'YP0002', 원산지: '8809000000002' }),
        validRow({ 상품번호: '6572', 재고번호SKU: 'YP0003', 원산지: '8809000000003' }),
      ],
      { existingExternalProductIds: new Map([['6571', 'KODY-PROD-000099']]) },
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
