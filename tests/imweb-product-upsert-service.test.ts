import { describe, expect, it, vi } from 'vitest';

import { ActionLogWriter } from '@/application/shared/action-log-writer.js';
import { ProductService } from '@/application/product/product-service.js';
import type { ImwebMappedProduct } from '@/application/product/imweb-product-importer.js';

const NOW = new Date('2026-06-09T12:00:00Z');

describe('ProductService Imweb import upsert contract', () => {
  it('creates a KODY-owned Product and ProductExternalMapping when the Imweb external ID is new', async () => {
    const repo = buildRepository();
    const service = new ProductService(repo, new ActionLogWriter(repo.actionLog));

    const result = await service.upsertImwebProduct({
      actorUserId: 'admin_1',
      importBatchId: 'batch_1',
      rawHash: 'hash-6571',
      mapped: mappedProduct({ externalProductId: '6571', sku: 'YP0885', barcode: '8809704435086' }),
    });

    expect(result.status).toBe('create');
    expect(result.product.id).toBe('KODY-PROD-000001');
    expect(repo.product.findFirst).toHaveBeenCalledWith({ where: { sku: 'YP0885' } });
    expect(repo.product.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: 'KODY-PROD-000001',
        category: 'ALBUM',
        categoryMappingSource: 'EXACT',
        sourceCategoryCodes: ['CATE70', 'CATE65'],
        name: 'ILLIT Album',
        labelName: 'BELIFT LAB',
        releaseDateText: '2026-04-30',
        releaseDate: new Date('2026-04-30T00:00:00.000Z'),
        priceKRW: '17440.0000',
        weightG: 1,
        sku: 'YP0885',
        barcode: '8809704435086',
        stockOnHand: 14,
        saleStatus: 'ON_SALE',
        isDisplayed: true,
        categoryReviewStatus: 'MAPPED',
      }),
    });
    const createData = repo.product.create.mock.calls[0][0].data;
    expect(createData).not.toHaveProperty('artistId');
    expect(createData).not.toHaveProperty('externalProductId');
    expect(repo.importRow.create).not.toHaveBeenCalled();
    expect(repo.productExternalMapping.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        productId: 'KODY-PROD-000001',
        sourceSystem: 'IMWEB_KR',
        externalProductId: '6571',
        externalUrl: 'https://kodyglobalkr.imweb.me/63/?idx=6571',
        firstImportBatchId: 'batch_1',
        lastImportBatchId: 'batch_1',
        lastRawHash: 'hash-6571',
        status: 'ACTIVE',
      }),
    });
  });



  it('stores unmapped category provenance and marks the Product as needing review', async () => {
    const repo = buildRepository();
    const service = new ProductService(repo, new ActionLogWriter(repo.actionLog));

    const result = await service.upsertImwebProduct({
      actorUserId: 'admin_1',
      importBatchId: 'batch_category_fallback',
      rawHash: 'hash-fallback-category',
      mapped: mappedProduct({
        externalProductId: '9999',
        category: null,
        rawCategoryIds: ['CATE999'],
        categoryMappingSource: 'FALLBACK',
      }),
    });

    expect(result.status).toBe('create');
    expect(repo.product.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        category: null,
        categoryMappingSource: 'FALLBACK',
        sourceCategoryCodes: ['CATE999'],
        categoryReviewStatus: 'NEEDS_REVIEW',
      }),
    });
  });


  it('rejects duplicate SKU on Imweb create import even though the database has no unique constraint', async () => {
    const repo = buildRepository({ existingSkuProduct: storedProduct({ id: 'KODY-PROD-EXISTING', sku: 'YP0885' }) });
    const service = new ProductService(repo, new ActionLogWriter(repo.actionLog));

    await expect(
      service.upsertImwebProduct({
        actorUserId: 'admin_1',
        importBatchId: 'batch_duplicate_sku_create',
        rawHash: 'hash-duplicate-sku-create',
        mapped: mappedProduct({ externalProductId: '7777', sku: 'YP0885' }),
      }),
    ).rejects.toMatchObject({ code: 'DUPLICATE_SKU', statusCode: 409 });

    expect(repo.product.create).not.toHaveBeenCalled();
    expect(repo.productExternalMapping.create).not.toHaveBeenCalled();
  });

  it('allows duplicate barcode on Imweb create import because barcode is search evidence, not identity', async () => {
    const repo = buildRepository({
      existingProduct: storedProduct({ id: 'KODY-PROD-EXISTING-BARCODE', sku: 'OTHER-SKU', barcode: '8809704435086' }),
    });
    const service = new ProductService(repo, new ActionLogWriter(repo.actionLog));

    const result = await service.upsertImwebProduct({
      actorUserId: 'admin_1',
      importBatchId: 'batch_duplicate_barcode_allowed',
      rawHash: 'hash-duplicate-barcode-allowed',
      mapped: mappedProduct({ externalProductId: '8888', sku: 'SKU-UNIQUE', barcode: '8809704435086' }),
    });

    expect(result.status).toBe('create');
    expect(repo.product.findFirst).toHaveBeenCalledWith({ where: { sku: 'SKU-UNIQUE' } });
    expect(repo.product.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: 'KODY-PROD-000001',
        sku: 'SKU-UNIQUE',
        barcode: '8809704435086',
      }),
    });
    expect(repo.productExternalMapping.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sourceSystem: 'IMWEB_KR',
        externalProductId: '8888',
      }),
    });
  });

  it('rejects duplicate SKU on Imweb update when the SKU belongs to another Product', async () => {
    const repo = buildRepository({
      existingMapping: {
        id: 'map_6571',
        productId: 'KODY-PROD-000123',
        sourceSystem: 'IMWEB_KR',
        externalProductId: '6571',
      },
      existingProduct: storedProduct({ id: 'KODY-PROD-000123', sku: 'OLD-SKU' }),
      existingSkuProduct: storedProduct({ id: 'KODY-PROD-OTHER', sku: 'YP0885' }),
    });
    const service = new ProductService(repo, new ActionLogWriter(repo.actionLog));

    await expect(
      service.upsertImwebProduct({
        actorUserId: 'admin_1',
        importBatchId: 'batch_duplicate_sku_update',
        rawHash: 'hash-duplicate-sku-update',
        mapped: mappedProduct({ externalProductId: '6571', sku: 'YP0885' }),
      }),
    ).rejects.toMatchObject({ code: 'DUPLICATE_SKU', statusCode: 409 });

    expect(repo.product.update).not.toHaveBeenCalled();
    expect(repo.productExternalMapping.update).not.toHaveBeenCalled();
  });

  it('stores parsed Imweb required option values on ProductOption for import display', async () => {
    const repo = buildRepository();
    const service = new ProductService(repo, new ActionLogWriter(repo.actionLog));

    await service.upsertImwebProduct({
      actorUserId: 'admin_1',
      importBatchId: 'batch_options',
      rawHash: 'hash-options',
      mapped: mappedProduct({
        optionName: 'VERSION',
        optionValues: ['MUSIC PLANET', 'KTOWN4U'],
      }),
    });

    expect(repo.productOption.deleteMany).toHaveBeenCalledWith({ where: { productId: 'KODY-PROD-000001' } });
    expect(repo.productOption.create).toHaveBeenCalledWith({
      data: {
        productId: 'KODY-PROD-000001',
        name: 'VERSION',
        position: 0,
        values: {
          create: [
            { value: 'MUSIC PLANET', position: 0, priceDeltaKRW: 0 },
            { value: 'KTOWN4U', position: 1, priceDeltaKRW: 0 },
          ],
        },
      },
    });
  });

  it('persists structured warning evidence on ImportRow when a write import row is provided', async () => {
    const repo = buildRepository();
    const service = new ProductService(repo, new ActionLogWriter(repo.actionLog));

    await service.upsertImwebProduct({
      actorUserId: 'admin_1',
      importBatchId: 'batch_warning',
      rawHash: 'hash-warning-row',
      importRow: {
        rowIndex: 12,
        rawPayload: { '상품번호': '6219', '카테고리ID': 'CATE5', '판매가': '0' },
        warnings: [
          {
            code: 'CATEGORY_UNMAPPED',
            severity: 'REVIEW',
            domain: 'CATEGORY',
            scope: 'KODY_REVIEW_REQUIRED',
            field: '카테고리ID',
            message: 'KODY 상품 카테고리로 명확히 매핑되지 않아 category=null 검수 대상으로 dry-run 처리합니다.',
            context: { rawCategoryIds: ['CATE5'], assignedCategory: null },
          },
          {
            code: 'ZERO_PRICE',
            severity: 'REVIEW',
            domain: 'PRICE',
            scope: 'KODY_REVIEW_REQUIRED',
            field: '판매가',
            message: '판매가가 0원이므로 가격 검수 필요 상태로 등록합니다.',
            context: { sourcePriceRaw: '0', priceKRW: '0.0000' },
          },
        ],
      },
      mapped: mappedProduct({
        externalProductId: '6219',
        category: null,
        rawCategoryIds: ['CATE5'],
        categoryMappingSource: 'FALLBACK',
        priceKRW: '0.0000',
        priceStatus: 'ZERO_NEEDS_REVIEW',
        sourcePriceRaw: '0',
      }),
    });

    expect(repo.importRow.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        batchId: 'batch_warning',
        sourceSystem: 'IMWEB_KR',
        rowIndex: 12,
        externalProductId: '6219',
        rawHash: 'hash-warning-row',
        rawPayload: { '상품번호': '6219', '카테고리ID': 'CATE5', '판매가': '0' },
        outcome: 'NEEDS_REVIEW',
        sourcePriceRaw: '0',
        parsedPriceKRW: '0.0000',
        assignedPriceStatus: 'ZERO_NEEDS_REVIEW',
        warningCodes: ['CATEGORY_UNMAPPED', 'ZERO_PRICE'],
        reviewRequired: true,
        productId: 'KODY-PROD-000001',
        mappingId: 'map_new',
      }),
    });
    expect(repo.importRow.create.mock.calls[0][0].data.warnings).toHaveLength(2);
  });


  it('updates the mapped Product and refreshes the existing ProductExternalMapping when the Imweb external ID already exists', async () => {
    const repo = buildRepository({
      existingMapping: {
        id: 'map_6571',
        productId: 'KODY-PROD-000123',
        sourceSystem: 'IMWEB_KR',
        externalProductId: '6571',
      },
      existingProduct: storedProduct({ id: 'KODY-PROD-000123', name: 'Old Name' }),
    });
    const service = new ProductService(repo, new ActionLogWriter(repo.actionLog));

    const result = await service.upsertImwebProduct({
      actorUserId: 'admin_1',
      importBatchId: 'batch_2',
      rawHash: 'hash-6571-v2',
      mapped: mappedProduct({ externalProductId: '6571', name: 'Updated ILLIT Album', stockOnHand: 5 }),
    });

    expect(result.status).toBe('update');
    expect(result.product.id).toBe('KODY-PROD-000123');
    expect(repo.product.create).not.toHaveBeenCalled();
    expect(repo.product.update).toHaveBeenCalledWith({
      where: { id: 'KODY-PROD-000123' },
      data: expect.objectContaining({
        name: 'Updated ILLIT Album',
        stockOnHand: 5,
        sourceCategoryCodes: ['CATE70', 'CATE65'],
      }),
    });
    expect(repo.productExternalMapping.update).toHaveBeenCalledWith({
      where: { id: 'map_6571' },
      data: expect.objectContaining({
        externalUrl: 'https://kodyglobalkr.imweb.me/63/?idx=6571',
        lastImportBatchId: 'batch_2',
        lastRawHash: 'hash-6571-v2',
        status: 'ACTIVE',
      }),
    });
  });

  it('does not update a detached ORPHANED mapping on re-import', async () => {
    const repo = buildRepository({
      existingMapping: {
        id: 'map_orphaned',
        productId: 'KODY-PROD-WRONG',
        sourceSystem: 'IMWEB_KR',
        externalProductId: '6571',
        status: 'ORPHANED',
      },
      existingProduct: storedProduct({ id: 'KODY-PROD-WRONG', name: 'Wrong Product' }),
    });
    const service = new ProductService(repo, new ActionLogWriter(repo.actionLog));

    await expect(
      service.upsertImwebProduct({
        actorUserId: 'admin_1',
        importBatchId: 'batch_orphaned',
        rawHash: 'hash-orphaned',
        mapped: mappedProduct({ externalProductId: '6571', name: 'Correct Source Product' }),
      }),
    ).rejects.toMatchObject({ code: 'EXTERNAL_MAPPING_ORPHANED', statusCode: 409 });

    expect(repo.product.update).not.toHaveBeenCalled();
    expect(repo.productExternalMapping.update).not.toHaveBeenCalled();
    expect(repo.product.create).not.toHaveBeenCalled();
  });

  it('drops unsafe Imweb external URLs instead of persisting executable link schemes', async () => {
    const repo = buildRepository({
      existingMapping: {
        id: 'map_6571',
        productId: 'KODY-PROD-000123',
        sourceSystem: 'IMWEB_KR',
        externalProductId: '6571',
      },
      existingProduct: storedProduct({ id: 'KODY-PROD-000123' }),
    });
    const service = new ProductService(repo, new ActionLogWriter(repo.actionLog));

    await service.upsertImwebProduct({
      actorUserId: 'admin_1',
      importBatchId: 'batch_unsafe_url',
      rawHash: 'hash-unsafe-url',
      mapped: mappedProduct({ externalProductId: '6571', productUrl: 'javascript:alert(1)' }),
    });

    expect(repo.productExternalMapping.update).toHaveBeenCalledWith({
      where: { id: 'map_6571' },
      data: expect.objectContaining({ externalUrl: null }),
    });
  });

  it('preserves existing thumbnail and detail HTML when Imweb re-import sends blank values', async () => {
    const repo = buildRepository({
      existingMapping: {
        id: 'map_6571',
        productId: 'KODY-PROD-000123',
        sourceSystem: 'IMWEB_KR',
        externalProductId: '6571',
      },
      existingProduct: storedProduct({
        id: 'KODY-PROD-000123',
        thumbnailUrl: 'https://cdn.imweb.me/original.png',
        detailHtml: '<p>original detail</p>',
      }),
    });
    const service = new ProductService(repo, new ActionLogWriter(repo.actionLog));

    await service.upsertImwebProduct({
      actorUserId: 'admin_1',
      importBatchId: 'batch_blank_media',
      rawHash: 'hash-blank-media',
      mapped: mappedProduct({ externalProductId: '6571', thumbnailUrl: '', detailHtml: '' }),
    });

    const updateData = repo.product.update.mock.calls[0][0].data;
    expect(updateData).not.toHaveProperty('thumbnailUrl');
    expect(updateData).not.toHaveProperty('detailHtml');
  });

  it('does not overwrite a confirmed product price when Imweb re-import sends a missing price', async () => {
    const repo = buildRepository({
      existingMapping: {
        id: 'map_6571',
        productId: 'KODY-PROD-000123',
        sourceSystem: 'IMWEB_KR',
        externalProductId: '6571',
      },
      existingProduct: storedProduct({
        id: 'KODY-PROD-000123',
        priceKRW: '12000.0000',
        priceStatus: 'CONFIRMED',
        lastConfirmedPriceKRW: '12000.0000',
        lastConfirmedPriceAt: NOW,
      }),
    });
    const service = new ProductService(repo, new ActionLogWriter(repo.actionLog));

    await service.upsertImwebProduct({
      actorUserId: 'admin_1',
      importBatchId: 'batch_3',
      rawHash: 'hash-6571-missing-price',
      mapped: mappedProduct({
        externalProductId: '6571',
        priceKRW: '0.0000',
        priceStatus: 'MISSING',
        sourcePriceRaw: '가격없음',
      }),
    });

    expect(repo.product.update).toHaveBeenCalledWith({
      where: { id: 'KODY-PROD-000123' },
      data: expect.objectContaining({
        priceKRW: '12000.0000',
        priceStatus: 'STALE_NEEDS_RECONFIRM',
        lastConfirmedPriceKRW: '12000.0000',
        sourcePriceRaw: '가격없음',
      }),
    });
  });

});

function mappedProduct(overrides: Partial<ImwebMappedProduct> = {}): ImwebMappedProduct {
  return {
    externalProductId: '6571',
    name: 'ILLIT Album',
    category: 'ALBUM',
    artistName: 'BELIFT LAB',
    priceKRW: '17440.0000',
    priceStatus: 'CONFIRMED',
    sourcePriceRaw: '17440',
    categoryMappingSource: 'EXACT',
    weightG: 1,
    sku: 'YP0885',
    barcode: '8809704435086',
    stockOnHand: 14,
    avgPurchasePriceKRW: 0,
    optionName: 'VERSION',
    optionValues: ['MUSIC PLANET', 'KTOWN4U'],
    releaseDateText: '2026-04-30',
    releaseDate: new Date('2026-04-30T00:00:00.000Z'),
    rawCategoryIds: ['CATE70', 'CATE65'],
    saleStatus: '판매중',
    displayStatus: true,
    productUrl: 'https://kodyglobalkr.imweb.me/63/?idx=6571',
    thumbnailUrl: 'https://cdn.imweb.me/thumbnail/20260519/524b0c5e22bb422e.png',
    detailHtml: '<p>ILLIT Album detail</p>',
    ...overrides,
  };
}

function storedProduct(
  overrides: Partial<ReturnType<typeof baseStoredProduct>> & {
    thumbnailUrl?: string | null;
    detailHtml?: string | null;
  } = {},
) {
  return { ...baseStoredProduct(), ...overrides };
}

function baseStoredProduct() {
  return {
    id: 'KODY-PROD-000001',
    artistId: null,
    category: 'ALBUM' as const,
    name: 'ILLIT Album',
    labelName: 'BELIFT LAB',
    thumbnailUrl: null,
    detailHtml: null,
    releaseDateText: null,
    releaseDate: null,
    weightG: 1,
    priceKRW: '17440.0000',
    priceStatus: 'CONFIRMED' as const,
    lastConfirmedPriceKRW: '17440.0000',
    lastConfirmedPriceAt: NOW,
    sourcePriceRaw: '17440',
    sku: 'YP0885',
    barcode: '8809704435086',
    avgPurchasePriceKRW: 0,
    stockManaged: true,
    stockOnHand: 14,
    orderBasedStock: 0,
    shipmentBasedStock: 0,
    saleStatus: 'ON_SALE' as const,
    isDisplayed: true,
    categoryMappingSource: 'EXACT' as const,
    sourceCategoryCodes: ['CATE70', 'CATE65'],
    categoryReviewStatus: 'PENDING' as const,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function buildRepository(input: {
  existingMapping?: { id: string; productId: string; sourceSystem: string; externalProductId: string; status?: string } | null;
  existingProduct?: ReturnType<typeof storedProduct> | null;
  existingSkuProduct?: ReturnType<typeof storedProduct> | null;
} = {}) {
  const createdProduct = storedProduct();
  const updatedProduct = input.existingProduct
    ? storedProduct({ ...input.existingProduct, name: 'Updated ILLIT Album', stockOnHand: 5 })
    : createdProduct;

  return {
    artist: {
      create: vi.fn(),
      findUnique: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
    },
    product: {
      create: vi.fn(async () => createdProduct),
      findUnique: vi.fn(async (args: { where: { id?: string } }) => {
        if (args.where.id === input.existingProduct?.id) return input.existingProduct;
        return null;
      }),
      findFirst: vi.fn(async (args: { where: { sku?: string } }) => {
        if (args.where.sku && input.existingSkuProduct?.sku === args.where.sku) return input.existingSkuProduct;
        return null;
      }),
      findMany: vi.fn(async () => []),
      update: vi.fn(async () => updatedProduct),
    },
    productExternalMapping: {
      findUnique: vi.fn(async () => input.existingMapping ?? null),
      create: vi.fn(async () => ({ id: 'map_new', productId: createdProduct.id })),
      update: vi.fn(async () => input.existingMapping ?? { id: 'map_new', productId: createdProduct.id }),
    },
    productOption: {
      deleteMany: vi.fn(async () => ({})),
      create: vi.fn(async () => ({})),
      findMany: vi.fn(async () => []),
    },
    importRow: {
      create: vi.fn(async () => ({})),
      findMany: vi.fn(async () => []),
    },
    productSequence: {
      upsert: vi.fn(async () => ({ key: 'KODY-PROD', lastSeq: 1 })),
    },
    stockMovement: {
      create: vi.fn(),
      findMany: vi.fn(async () => []),
    },
    fxRate: {
      findFirst: vi.fn(async () => ({ rateToKRW: '1360.0000' })),
    },
    actionLog: { create: vi.fn(async () => ({})) },
  };
}
