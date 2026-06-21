import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

import { ActionLogWriter } from '@/application/shared/action-log-writer.js';
import { ProductService } from '@/application/product/product-service.js';
import { parseImwebProductRow } from '@/application/product/imweb-product-importer.js';

const databaseUrl = process.env.DATABASE_URL;
const runDbIntegration = process.env.KODY_RUN_DB_INTEGRATION === '1';
const runImwebWriteSmoke = process.env.KODY_RUN_IMWEB_WRITE_SMOKE === '1';
const describeWriteSmoke = runDbIntegration && runImwebWriteSmoke ? describe : describe.skip;

const prisma = new PrismaClient();

const SMOKE_TAG = 'HERMES-SMOKE-20260621-001';
const SMOKE_BARCODE = '8800000000006';
const SMOKE_SOURCE_FILE = 'hermes-smoke-imweb-20260621.xlsx';
const SMOKE_SOURCE_HASH = 'hermes-smoke-source-hash-20260621';
const CREATE_BATCH_FILE = `${SMOKE_SOURCE_FILE}#create`;
const UPDATE_BATCH_FILE = `${SMOKE_SOURCE_FILE}#update`;

interface CleanupEvidence {
  importRows: number;
  importBatches: number;
  actionLogs: number;
  optionValues: number;
  options: number;
  mappings: number;
  products: number;
  productSequenceRestored: boolean;
  productSequenceLastSeqBefore: number | null;
  productSequenceLastSeqAfter: number | null;
}

let originalProductSequenceLastSeq: number | null = null;

function assertLocalDatabaseUrl(url: string | undefined): URL {
  if (!url) {
    throw new Error('KODY_RUN_IMWEB_WRITE_SMOKE requires DATABASE_URL');
  }
  const parsed = new URL(url);
  const localHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
  if (!localHosts.has(parsed.hostname)) {
    throw new Error('KODY_RUN_IMWEB_WRITE_SMOKE requires DATABASE_URL host to be localhost, 127.0.0.1, ::1, or [::1]');
  }
  return parsed;
}

async function findSmokeProductId(): Promise<string | undefined> {
  const mapping = await prisma.productExternalMapping.findUnique({
    where: {
      sourceSystem_externalProductId: {
        sourceSystem: 'IMWEB_KR',
        externalProductId: SMOKE_TAG,
      },
    },
  });
  if (mapping) return mapping.productId;

  const product = await prisma.product.findFirst({
    where: { OR: [{ sku: `${SMOKE_TAG}-SKU` }, { barcode: SMOKE_BARCODE }, { name: { contains: SMOKE_TAG } }] },
    orderBy: { createdAt: 'desc' },
  });
  return product?.id;
}

async function cleanupSmokeRows(): Promise<CleanupEvidence> {
  const productId = await findSmokeProductId();
  const importBatches = await prisma.importBatch.findMany({
    where: {
      sourceSystem: 'IMWEB_KR',
      OR: [
        { sourceFileName: { startsWith: SMOKE_SOURCE_FILE } },
        { sourceFileHash: SMOKE_SOURCE_HASH },
        { triggeredBy: SMOKE_TAG },
      ],
    },
    select: { id: true },
  });
  const batchIds = importBatches.map((batch) => batch.id);

  const deletedImportRows = await prisma.importRow.deleteMany({
    where: {
      OR: [
        { externalProductId: SMOKE_TAG },
        ...(batchIds.length > 0 ? [{ batchId: { in: batchIds } }] : []),
      ],
    },
  });
  const deletedImportBatches = await prisma.importBatch.deleteMany({
    where: { id: { in: batchIds } },
  });

  let deletedActionLogs = { count: 0 };
  let deletedOptionValues = { count: 0 };
  let deletedOptions = { count: 0 };
  let deletedProducts = { count: 0 };
  if (productId) {
    deletedActionLogs = await prisma.actionLog.deleteMany({ where: { targetType: 'Product', targetId: productId } });
    deletedOptionValues = await prisma.productOptionValue.deleteMany({ where: { option: { productId } } });
    deletedOptions = await prisma.productOption.deleteMany({ where: { productId } });
  }

  const deletedMappings = await prisma.productExternalMapping.deleteMany({
    where: { sourceSystem: 'IMWEB_KR', externalProductId: SMOKE_TAG },
  });

  if (productId) {
    deletedProducts = await prisma.product.deleteMany({ where: { id: productId } });
  }

  let productSequenceRestored = false;
  if (originalProductSequenceLastSeq !== null) {
    await prisma.productSequence.upsert({
      where: { key: 'KODY-PROD' },
      create: { key: 'KODY-PROD', lastSeq: originalProductSequenceLastSeq },
      update: { lastSeq: originalProductSequenceLastSeq },
    });
    productSequenceRestored = true;
  }
  const restoredSequence = await prisma.productSequence.findUnique({ where: { key: 'KODY-PROD' } });

  return {
    importRows: deletedImportRows.count,
    importBatches: deletedImportBatches.count,
    actionLogs: deletedActionLogs.count,
    optionValues: deletedOptionValues.count,
    options: deletedOptions.count,
    mappings: deletedMappings.count,
    products: deletedProducts.count,
    productSequenceRestored,
    productSequenceLastSeqBefore: originalProductSequenceLastSeq,
    productSequenceLastSeqAfter: restoredSequence?.lastSeq ?? null,
  };
}

function buildSmokeRow(nameSuffix: string) {
  return {
    상품번호: SMOKE_TAG,
    상품명: `[HERMES SMOKE ${SMOKE_TAG}] Imweb dev write product ${nameSuffix}`,
    카테고리ID: 'CATE999',
    판매가: '17440',
    무게: '0.001',
    원가: '0',
    재고번호SKU: `${SMOKE_TAG}-SKU`,
    원산지: SMOKE_BARCODE,
    브랜드: 'HERMES TEST LABEL',
    제조사: 'unsafe-date-from-smoke',
    재고사용: 'Y',
    '현재 재고수량': nameSuffix === 'updated' ? '5' : '3',
    옵션사용: 'Y',
    필수옵션명: '버전',
    필수옵션값: 'Smoke A,Smoke B',
    판매상태: '판매중',
    진열상태: 'Y',
    상품URL: `https://example.invalid/hermes-smoke/${SMOKE_TAG}`,
    대표이미지URL: null,
    상품상세정보: '<p>synthetic hermes smoke fixture</p>',
  };
}

async function createImportBatch(sourceFileName: string) {
  return prisma.importBatch.create({
    data: {
      sourceSystem: 'IMWEB_KR',
      sourceFileName,
      sourceFileHash: SMOKE_SOURCE_HASH,
      status: 'RUNNING',
      isDryRun: false,
      totalRows: 1,
      triggeredBy: SMOKE_TAG,
    },
  });
}

describe('Imweb write smoke safety guard', () => {
  it('rejects non-local DATABASE_URL before any smoke write can run', () => {
    expect(() => assertLocalDatabaseUrl('postgresql://user:pass@prod.example.com:5432/kody')).toThrow(/localhost/);
    expect(assertLocalDatabaseUrl('postgresql://user:pass@localhost:5432/kody').hostname).toBe('localhost');
  });
});

describeWriteSmoke('Imweb product dev-only write smoke', () => {
  beforeAll(async () => {
    assertLocalDatabaseUrl(databaseUrl);
    const sequence = await prisma.productSequence.findUnique({ where: { key: 'KODY-PROD' } });
    originalProductSequenceLastSeq = sequence?.lastSeq ?? null;
    await cleanupSmokeRows();
  });

  afterAll(async () => {
    await cleanupSmokeRows();
    await prisma.$disconnect();
  });

  it('creates and updates one synthetic Imweb product, records IDs, then cleans up completely', async () => {
    const parsedTarget = assertLocalDatabaseUrl(databaseUrl);
    const actor = await prisma.user.findFirst({ where: { status: 'ACTIVE' }, orderBy: { createdAt: 'asc' } });
    expect(actor, 'local smoke requires one existing dev user so ActionLog FK stays in scope').not.toBeNull();

    const service = new ProductService(prisma as never, new ActionLogWriter(prisma.actionLog as never));
    const createdBatch = await createImportBatch(CREATE_BATCH_FILE);
    const updatedBatch = await createImportBatch(UPDATE_BATCH_FILE);

    const createdItem = parseImwebProductRow(buildSmokeRow('created'), 1);
    expect(createdItem.status).toBe('create');
    expect(createdItem.mapped).not.toBeNull();
    expect(createdItem.warnings.map((warning) => warning.code)).toContain('CATEGORY_UNMAPPED');

    const updatedItem = parseImwebProductRow(buildSmokeRow('updated'), 1);
    expect(updatedItem.mapped).not.toBeNull();

    const createResult = await service.upsertImwebProduct({
      actorUserId: actor!.id,
      importBatchId: createdBatch.id,
      rawHash: `${SMOKE_TAG}-create-hash`,
      importRow: {
        rowIndex: createdItem.rowNumber,
        rawPayload: buildSmokeRow('created'),
        warnings: createdItem.warnings,
      },
      mapped: createdItem.mapped!,
      ipAddress: '127.0.0.1',
      userAgent: 'hermes-imweb-write-smoke',
    });

    const updateResult = await service.upsertImwebProduct({
      actorUserId: actor!.id,
      importBatchId: updatedBatch.id,
      rawHash: `${SMOKE_TAG}-update-hash`,
      importRow: {
        rowIndex: updatedItem.rowNumber,
        rawPayload: buildSmokeRow('updated'),
        warnings: updatedItem.warnings,
      },
      mapped: updatedItem.mapped!,
      ipAddress: '127.0.0.1',
      userAgent: 'hermes-imweb-write-smoke',
    });

    expect(createResult.status).toBe('create');
    expect(updateResult.status).toBe('update');
    expect(updateResult.product.id).toBe(createResult.product.id);
    expect(createResult.product.id).toMatch(/^KODY-PROD-\d{6}$/);
    expect(createResult.product.id).not.toBe(SMOKE_TAG);
    expect(createResult.product.id).not.toMatch(/^IMWEB-/);

    const mapping = await prisma.productExternalMapping.findUniqueOrThrow({
      where: { sourceSystem_externalProductId: { sourceSystem: 'IMWEB_KR', externalProductId: SMOKE_TAG } },
    });
    const importRows = await prisma.importRow.findMany({
      where: { externalProductId: SMOKE_TAG },
      orderBy: { createdAt: 'asc' },
    });
    const options = await prisma.productOption.findMany({
      where: { productId: createResult.product.id },
      include: { values: { orderBy: { position: 'asc' } } },
    });
    const actionLogs = await prisma.actionLog.findMany({
      where: { targetType: 'Product', targetId: createResult.product.id },
      orderBy: { createdAt: 'asc' },
    });

    expect(mapping.productId).toBe(createResult.product.id);
    expect(mapping.sourceSystem).toBe('IMWEB_KR');
    expect(importRows).toHaveLength(2);
    expect(importRows.map((row) => row.outcome)).toEqual(['NEEDS_REVIEW', 'NEEDS_REVIEW']);
    expect(importRows.every((row) => row.reviewRequired)).toBe(true);
    expect(importRows.every((row) => row.warningCodes.includes('CATEGORY_UNMAPPED'))).toBe(true);
    expect(options).toHaveLength(1);
    expect(options[0].values.map((value) => value.value)).toEqual(['Smoke A', 'Smoke B']);
    expect(actionLogs.map((log) => log.actionType)).toEqual(['PRODUCT_CREATE', 'PRODUCT_UPDATE']);

    const createdIds = {
      db: { host: parsedTarget.hostname, database: parsedTarget.pathname.replace(/^\//, '') },
      productId: createResult.product.id,
      mappingId: mapping.id,
      importBatchIds: [createdBatch.id, updatedBatch.id],
      importRowIds: importRows.map((row) => row.id),
      optionIds: options.map((option) => option.id),
      optionValueIds: options.flatMap((option) => option.values.map((value) => value.id)),
      actionLogIds: actionLogs.map((log) => log.id),
      statuses: { create: createResult.status, update: updateResult.status },
    };

    const cleanupEvidence = await cleanupSmokeRows();
    const residual = {
      products: await prisma.product.count({ where: { id: createResult.product.id } }),
      mappings: await prisma.productExternalMapping.count({ where: { id: mapping.id } }),
      importRows: await prisma.importRow.count({ where: { externalProductId: SMOKE_TAG } }),
      importBatches: await prisma.importBatch.count({ where: { id: { in: [createdBatch.id, updatedBatch.id] } } }),
      actionLogs: await prisma.actionLog.count({ where: { targetType: 'Product', targetId: createResult.product.id } }),
    };

    console.info('IMWEB_WRITE_SMOKE_EVIDENCE', JSON.stringify({ createdIds, cleanupEvidence, residual }, null, 2));

    expect(cleanupEvidence.products).toBe(1);
    expect(cleanupEvidence.mappings).toBe(1);
    expect(cleanupEvidence.importRows).toBe(2);
    expect(cleanupEvidence.importBatches).toBe(2);
    expect(cleanupEvidence.options).toBe(1);
    expect(cleanupEvidence.optionValues).toBe(2);
    expect(cleanupEvidence.actionLogs).toBe(2);
    expect(cleanupEvidence.productSequenceRestored).toBe(true);
    expect(cleanupEvidence.productSequenceLastSeqAfter).toBe(cleanupEvidence.productSequenceLastSeqBefore);
    expect(residual).toEqual({ products: 0, mappings: 0, importRows: 0, importBatches: 0, actionLogs: 0 });
  });
});
