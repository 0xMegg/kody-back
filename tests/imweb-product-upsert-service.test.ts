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
    expect(repo.product.findFirst).not.toHaveBeenCalled();
    expect(repo.product.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: 'KODY-PROD-000001',
        category: 'ALBUM',
        sourceCategoryCodes: ['CATE70', 'CATE65'],
        name: 'ILLIT Album',
        labelName: 'BELIFT LAB',
        priceKRW: '17440.0000',
        weightG: 1,
        sku: 'YP0885',
        barcode: '8809704435086',
        stockOnHand: 14,
        saleStatus: 'ON_SALE',
        isDisplayed: true,
      }),
    });
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
    weightG: 1,
    sku: 'YP0885',
    barcode: '8809704435086',
    stockOnHand: 14,
    avgPurchasePriceKRW: 0,
    optionName: 'VERSION',
    optionValues: ['MUSIC PLANET', 'KTOWN4U'],
    rawCategoryIds: ['CATE70', 'CATE65'],
    saleStatus: '판매중',
    displayStatus: true,
    productUrl: 'https://kodyglobalkr.imweb.me/63/?idx=6571',
    thumbnailUrl: 'https://cdn.imweb.me/thumbnail/20260519/524b0c5e22bb422e.png',
    ...overrides,
  };
}

function storedProduct(overrides: Partial<ReturnType<typeof baseStoredProduct>> = {}) {
  return { ...baseStoredProduct(), ...overrides };
}

function baseStoredProduct() {
  return {
    id: 'KODY-PROD-000001',
    artistId: null,
    category: 'ALBUM' as const,
    name: 'ILLIT Album',
    weightG: 1,
    priceKRW: '17440.0000',
    priceStatus: 'CONFIRMED' as const,
    lastConfirmedPriceKRW: '17440.0000',
    lastConfirmedPriceAt: NOW,
    sourcePriceRaw: '17440',
    sku: 'YP0885',
    barcode: '8809704435086',
    avgPurchasePriceKRW: 0,
    stockOnHand: 14,
    orderBasedStock: 0,
    shipmentBasedStock: 0,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function buildRepository(input: {
  existingMapping?: { id: string; productId: string; sourceSystem: string; externalProductId: string } | null;
  existingProduct?: ReturnType<typeof storedProduct> | null;
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
      findFirst: vi.fn(async () => { throw new Error('SKU/barcode uniqueness must not gate Imweb import upsert'); }),
      findMany: vi.fn(async () => []),
      update: vi.fn(async () => updatedProduct),
    },
    productExternalMapping: {
      findUnique: vi.fn(async () => input.existingMapping ?? null),
      create: vi.fn(async () => ({ id: 'map_new', productId: createdProduct.id })),
      update: vi.fn(async () => input.existingMapping ?? { id: 'map_new', productId: createdProduct.id }),
    },
    productSequence: {
      upsert: vi.fn(async () => ({ key: 'KODY-PROD', lastSeq: 1 })),
    },
    stockMovement: {
      create: vi.fn(),
      findMany: vi.fn(async () => []),
    },
    actionLog: { create: vi.fn(async () => ({})) },
  };
}
