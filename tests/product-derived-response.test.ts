import { describe, expect, it, vi } from 'vitest';

import { ActionLogWriter } from '@/application/shared/action-log-writer.js';
import { ProductService } from '@/application/product/product-service.js';
import type { ProductSaleStatus } from '@/domain/shared/types.js';

const NOW = new Date('2026-06-20T00:00:00Z');

describe('ProductService derived response fields', () => {
  describe('displayStatus derivation', () => {
    const cases: Array<{
      saleStatus: ProductSaleStatus;
      isDisplayed: boolean;
      expected: 'ON_SALE' | 'SOLD_OUT' | 'HIDDEN' | 'DRAFT';
    }> = [
      { saleStatus: 'ON_SALE', isDisplayed: true, expected: 'ON_SALE' },
      { saleStatus: 'SOLD_OUT', isDisplayed: true, expected: 'SOLD_OUT' },
      { saleStatus: 'DRAFT', isDisplayed: true, expected: 'DRAFT' },
      // isDisplayed === false always wins -> HIDDEN, regardless of saleStatus.
      { saleStatus: 'OFF_SALE', isDisplayed: true, expected: 'HIDDEN' },
      { saleStatus: 'ON_SALE', isDisplayed: false, expected: 'HIDDEN' },
      { saleStatus: 'SOLD_OUT', isDisplayed: false, expected: 'HIDDEN' },
      { saleStatus: 'DRAFT', isDisplayed: false, expected: 'HIDDEN' },
      { saleStatus: 'OFF_SALE', isDisplayed: false, expected: 'HIDDEN' },
    ];

    for (const { saleStatus, isDisplayed, expected } of cases) {
      it(`derives ${expected} from saleStatus=${saleStatus}, isDisplayed=${isDisplayed}`, async () => {
        const repo = buildRepository({ product: storedProduct({ saleStatus, isDisplayed }) });
        const service = new ProductService(repo, new ActionLogWriter(repo.actionLog));

        const result = await service.getProduct('KODY-PROD-000001');

        expect(result.displayStatus).toBe(expected);
        // existing fields are preserved alongside the derived field.
        expect(result.saleStatus).toBe(saleStatus);
        expect(result.isDisplayed).toBe(isDisplayed);
      });
    }
  });

  it('includes derived fields on list results and reads the USD rate once per list call', async () => {
    const repo = buildRepository({
      product: storedProduct({
        id: 'KODY-PROD-000001',
        saleStatus: 'ON_SALE',
        isDisplayed: false,
        priceKRW: '2720.0000',
      }),
      additionalProducts: [
        storedProduct({
          id: 'KODY-PROD-000002',
          saleStatus: 'SOLD_OUT',
          isDisplayed: true,
          priceKRW: '4080.0000',
        }),
      ],
      rateToKRW: '1360.0000',
    });
    const service = new ProductService(repo, new ActionLogWriter(repo.actionLog));

    const result = await service.listProducts({ limit: 10 });

    expect(result.items).toHaveLength(2);
    expect(result.items.map((item) => ({
      id: item.id,
      saleStatus: item.saleStatus,
      isDisplayed: item.isDisplayed,
      displayStatus: item.displayStatus,
      priceUSD: item.priceUSD,
    }))).toEqual([
      {
        id: 'KODY-PROD-000001',
        saleStatus: 'ON_SALE',
        isDisplayed: false,
        displayStatus: 'HIDDEN',
        priceUSD: 2,
      },
      {
        id: 'KODY-PROD-000002',
        saleStatus: 'SOLD_OUT',
        isDisplayed: true,
        displayStatus: 'SOLD_OUT',
        priceUSD: 3,
      },
    ]);
    expect(repo.fxRate.findFirst).toHaveBeenCalledTimes(1);
  });

  describe('priceUSD derivation', () => {
    it('rounds half-up to an integer USD amount using the latest positive USD rate', async () => {
      // 17440 / 1360 = 12.82... -> 13
      const repo = buildRepository({
        product: storedProduct({ priceKRW: '17440.0000' }),
        rateToKRW: '1360.0000',
      });
      const service = new ProductService(repo, new ActionLogWriter(repo.actionLog));

      const result = await service.getProduct('KODY-PROD-000001');

      expect(result.priceUSD).toBe(13);
    });

    it('rounds an exact .5 ratio up (round-half-up)', async () => {
      // 1500 / 1000 = 1.5 -> 2
      const repo = buildRepository({
        product: storedProduct({ priceKRW: '1500.0000' }),
        rateToKRW: '1000.0000',
      });
      const service = new ProductService(repo, new ActionLogWriter(repo.actionLog));

      const result = await service.getProduct('KODY-PROD-000001');

      expect(result.priceUSD).toBe(2);
    });

    it('rounds a just-below-.5 ratio down', async () => {
      // 1499 / 1000 = 1.499 -> 1
      const repo = buildRepository({
        product: storedProduct({ priceKRW: '1499.0000' }),
        rateToKRW: '1000.0000',
      });
      const service = new ProductService(repo, new ActionLogWriter(repo.actionLog));

      const result = await service.getProduct('KODY-PROD-000001');

      expect(result.priceUSD).toBe(1);
    });

    it('returns 0 USD for a zero KRW price', async () => {
      const repo = buildRepository({
        product: storedProduct({ priceKRW: '0.0000' }),
        rateToKRW: '1360.0000',
      });
      const service = new ProductService(repo, new ActionLogWriter(repo.actionLog));

      const result = await service.getProduct('KODY-PROD-000001');

      expect(result.priceUSD).toBe(0);
    });

    it('returns null when no USD rate exists', async () => {
      const repo = buildRepository({ product: storedProduct(), rateToKRW: null });
      const service = new ProductService(repo, new ActionLogWriter(repo.actionLog));

      const result = await service.getProduct('KODY-PROD-000001');

      expect(result.priceUSD).toBeNull();
    });

    it('returns null when the latest USD rate is not positive', async () => {
      const repo = buildRepository({ product: storedProduct(), rateToKRW: '0.0000' });
      const service = new ProductService(repo, new ActionLogWriter(repo.actionLog));

      const result = await service.getProduct('KODY-PROD-000001');

      expect(result.priceUSD).toBeNull();
    });

    it('returns null when no fxRate accessor is wired on the repository', async () => {
      const repo = buildRepository({ product: storedProduct(), rateToKRW: '1360.0000' });
      // Simulate a repository that does not expose fxRate at all.
      delete (repo as { fxRate?: unknown }).fxRate;
      const service = new ProductService(repo, new ActionLogWriter(repo.actionLog));

      const result = await service.getProduct('KODY-PROD-000001');

      expect(result.priceUSD).toBeNull();
    });
  });
});

function storedProduct(
  overrides: Partial<ReturnType<typeof baseStoredProduct>> = {},
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
    categoryReviewStatus: 'MAPPED' as const,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function buildRepository(input: {
  product: ReturnType<typeof storedProduct>;
  additionalProducts?: ReturnType<typeof storedProduct>[];
  rateToKRW?: string | null;
}) {
  const rateToKRW = input.rateToKRW === undefined ? '1360.0000' : input.rateToKRW;
  const products = [input.product, ...(input.additionalProducts ?? [])];

  return {
    artist: {
      create: vi.fn(),
      findUnique: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
    },
    product: {
      create: vi.fn(),
      findUnique: vi.fn(async (args: { where: { id?: string } }) =>
        args.where.id === input.product.id ? input.product : null,
      ),
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => products),
      update: vi.fn(),
    },
    productExternalMapping: {
      findUnique: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      create: vi.fn(),
      update: vi.fn(),
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
      findFirst: vi.fn(async () => (rateToKRW === null ? null : { rateToKRW })),
    },
    actionLog: { create: vi.fn(async () => ({})) },
  };
}
