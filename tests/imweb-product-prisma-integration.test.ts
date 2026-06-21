import 'dotenv/config';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

const databaseUrl = process.env.DATABASE_URL;
const runDbIntegration = process.env.KODY_RUN_DB_INTEGRATION === '1';
const isLocalDatabase = databaseUrl
  ? ['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(databaseUrl).hostname)
  : false;
const describeDb = runDbIntegration ? describe : describe.skip;
const prisma = new PrismaClient();
const PRODUCT_ID = 'KODY-TEST-IMWEB-FK-ORDER';

async function cleanupSmokeProduct() {
  await prisma.productOptionValue.deleteMany({ where: { option: { productId: PRODUCT_ID } } });
  await prisma.productOption.deleteMany({ where: { productId: PRODUCT_ID } });
  await prisma.product.deleteMany({ where: { id: PRODUCT_ID } });
}

describeDb('Imweb product option Prisma integration', () => {
  beforeAll(async () => {
    if (!isLocalDatabase) {
      throw new Error('KODY_RUN_DB_INTEGRATION=1 requires DATABASE_URL host to be localhost, 127.0.0.1, or ::1');
    }
    await cleanupSmokeProduct();
  });

  afterAll(async () => {
    await cleanupSmokeProduct();
    await prisma.$disconnect();
  });

  it('supports deleting option values through the product-scoped nested relation filter before deleting options', async () => {
    await prisma.product.create({
      data: {
        id: PRODUCT_ID,
        name: '[HERMES TEST] Imweb option FK order',
        priceKRW: '0',
        sku: 'HERMES-FK-ORDER',
        barcode: 'HERMES-FK-ORDER',
      },
    });
    const option = await prisma.productOption.create({
      data: {
        productId: PRODUCT_ID,
        name: '버전',
        position: 0,
        values: {
          create: [
            { value: 'A', position: 0 },
            { value: 'B', position: 1 },
          ],
        },
      },
    });

    const deletedValues = await prisma.productOptionValue.deleteMany({ where: { option: { productId: PRODUCT_ID } } });
    const deletedOptions = await prisma.productOption.deleteMany({ where: { productId: PRODUCT_ID } });

    expect(option.productId).toBe(PRODUCT_ID);
    expect(deletedValues.count).toBe(2);
    expect(deletedOptions.count).toBe(1);
    await expect(prisma.productOptionValue.findMany({ where: { optionId: option.id } })).resolves.toEqual([]);
  });
});
