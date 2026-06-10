import { describe, expect, it, vi } from 'vitest';
import * as XLSX from '@e965/xlsx';
import { issueAccessToken } from '@/domain/auth/tokens.js';
import type {
  CategoryMappingSource,
  CategoryReviewStatus,
  ProductCategory,
  ProductSaleStatus,
  Role,
  StockMovementType,
  UserStatus,
} from '@/domain/shared/types.js';
import { buildTestServer as _buildTestServer } from './helpers.js';
import type { PrismaClient } from '@prisma/client';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildTestServer(prisma: any) {
  return _buildTestServer(prisma as Partial<PrismaClient>);
}

const ARTIST_ID = 'artist_1';
const PRODUCT_ID = 'P-ATEZ-001';

describe('product routes', () => {
  // ── POST /products ─────────────────────────────────────────────────────────

  it('rejects unauthenticated POST /products as AUTHENTICATION_ERROR', async () => {
    const prisma = buildPrisma({ actor: buildActor() });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/products',
      payload: validCreatePayload(),
    });
    const body = response.json();

    expect(response.statusCode).toBe(401);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('AUTHENTICATION_ERROR');

    await server.close();
  });

  it('rejects SALES from POST /products as AUTHORIZATION_ERROR', async () => {
    const actor = buildActor({ roles: ['SALES'] });
    const prisma = buildPrisma({ actor, artists: [buildStoredArtist()] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/products',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: validCreatePayload(),
    });
    const body = response.json();

    expect(response.statusCode).toBe(403);
    expect(body.error.code).toBe('AUTHORIZATION_ERROR');

    await server.close();
  });

  it('returns 404 when artist not found on POST /products', async () => {
    const actor = buildActor();
    const prisma = buildPrisma({ actor, artists: [] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/products',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: validCreatePayload(),
    });
    const body = response.json();

    expect(response.statusCode).toBe(404);
    expect(body.error.code).toBe('ARTIST_NOT_FOUND');

    await server.close();
  });

  it('creates product with all Slice 3.0 fields and returns them through the response', async () => {
    const actor = buildActor();
    const product = buildStoredProduct({
      id: 'KODY-PROD-000010',
      labelName: 'BELIFT LAB',
      releaseDateText: '2026-08-01',
      stockManaged: false,
      saleStatus: 'ON_SALE',
      isDisplayed: true,
      categoryMappingSource: 'MANUAL',
      sourceCategoryCodes: ['CATE70', 'CATE65'],
      categoryReviewStatus: 'MAPPED',
    });
    const prisma = buildPrisma({
      actor,
      artists: [buildStoredArtist()],
      createdProduct: product,
      nextProductSeq: 10,
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/products',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: validCreatePayload({
        labelName: 'BELIFT LAB',
        releaseDateText: '2026-08-01',
        stockManaged: false,
        saleStatus: 'ON_SALE',
        isDisplayed: true,
        categoryMappingSource: 'MANUAL',
        sourceCategoryCodes: ['CATE70', 'CATE65'],
        categoryReviewStatus: 'MAPPED',
      }),
    });
    const body = response.json();

    expect(response.statusCode).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.data.labelName).toBe('BELIFT LAB');
    expect(body.data.releaseDateText).toBe('2026-08-01');
    expect(body.data.stockManaged).toBe(false);
    expect(body.data.saleStatus).toBe('ON_SALE');
    expect(body.data.isDisplayed).toBe(true);
    expect(body.data.categoryMappingSource).toBe('MANUAL');
    expect(body.data.sourceCategoryCodes).toEqual(['CATE70', 'CATE65']);
    expect(body.data.categoryReviewStatus).toBe('MAPPED');

    const createCall = prisma.product.create.mock.calls[0][0];
    expect(createCall.data).toMatchObject({
      labelName: 'BELIFT LAB',
      releaseDateText: '2026-08-01',
      stockManaged: false,
      saleStatus: 'ON_SALE',
      isDisplayed: true,
      categoryMappingSource: 'MANUAL',
      sourceCategoryCodes: ['CATE70', 'CATE65'],
      categoryReviewStatus: 'MAPPED',
    });

    await server.close();
  });

  it('rejects invalid saleStatus on POST /products as VALIDATION_ERROR', async () => {
    const actor = buildActor();
    const prisma = buildPrisma({ actor, artists: [buildStoredArtist()] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/products',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: validCreatePayload({ saleStatus: 'NOT_A_STATUS' }),
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');

    await server.close();
  });

  it('creates product and returns 201 with KODY-owned product id even without artist', async () => {
    const actor = buildActor();
    const product = buildStoredProduct({ id: 'KODY-PROD-000001', artistId: null, category: null, weightG: null });
    const prisma = buildPrisma({ actor, createdProduct: product, nextProductSeq: 1 });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/products',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: validCreatePayload({ artistId: undefined, category: undefined, weightG: undefined }),
    });
    const body = response.json();

    expect(response.statusCode).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.data.id).toBe('KODY-PROD-000001');

    await server.close();
  });

  // ── GET /products ──────────────────────────────────────────────────────────

  it('lists products and returns 200 with nextCursor', async () => {
    const actor = buildActor();
    const products = [
      buildStoredProduct({ id: 'P-ATEZ-001' }),
      buildStoredProduct({ id: 'P-ATEZ-002' }),
    ];
    const prisma = buildPrisma({ actor, products });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/products?limit=1',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.items).toHaveLength(1);
    expect(body.data.nextCursor).toBe('P-ATEZ-001');

    await server.close();
  });

  it('allows SALES to GET /products', async () => {
    const actor = buildActor({ roles: ['SALES'] });
    const prisma = buildPrisma({ actor, products: [buildStoredProduct()] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/products',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });

    expect(response.statusCode).toBe(200);

    await server.close();
  });

  // ── GET /products/:id ──────────────────────────────────────────────────────

  it('returns product detail on GET /products/:id', async () => {
    const actor = buildActor();
    const product = buildStoredProduct();
    const prisma = buildPrisma({ actor, products: [product] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: `/products/${PRODUCT_ID}`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.data.id).toBe(PRODUCT_ID);

    await server.close();
  });

  it('returns 404 on GET /products/:id when not found', async () => {
    const actor = buildActor();
    const prisma = buildPrisma({ actor, products: [] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/products/missing',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });
    const body = response.json();

    expect(response.statusCode).toBe(404);
    expect(body.error.code).toBe('PRODUCT_NOT_FOUND');

    await server.close();
  });

  // ── PATCH /products/:id ────────────────────────────────────────────────────

  it('rejects SALES from PATCH /products/:id as AUTHORIZATION_ERROR', async () => {
    const actor = buildActor({ roles: ['SALES'] });
    const product = buildStoredProduct();
    const prisma = buildPrisma({ actor, products: [product] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'PATCH',
      url: `/products/${PRODUCT_ID}`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { name: 'Updated' },
    });
    const body = response.json();

    expect(response.statusCode).toBe(403);
    expect(body.error.code).toBe('AUTHORIZATION_ERROR');

    await server.close();
  });

  it('updates product and returns 200', async () => {
    const actor = buildActor();
    const product = buildStoredProduct();
    const updated = buildStoredProduct({ name: 'Updated Album' });
    const prisma = buildPrisma({ actor, products: [product], updatedProduct: updated });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'PATCH',
      url: `/products/${PRODUCT_ID}`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { name: 'Updated Album' },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.name).toBe('Updated Album');

    await server.close();
  });

  it('updates nullable form fields on PATCH /products/:id', async () => {
    const actor = buildActor();
    const product = buildStoredProduct({ artistId: ARTIST_ID, category: 'ALBUM', weightG: 150 });
    const updated = buildStoredProduct({ artistId: null, category: null, weightG: null });
    const prisma = buildPrisma({ actor, products: [product], updatedProduct: updated });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'PATCH',
      url: `/products/${PRODUCT_ID}`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { artistId: null, category: null, weightG: null },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.artistId).toBeNull();
    expect(body.data.category).toBeNull();
    expect(body.data.weightG).toBeNull();
    expect(prisma.product.update.mock.calls[0][0].data).toMatchObject({
      artistId: null,
      category: null,
      weightG: null,
    });

    await server.close();
  });

  it('returns 404 on PATCH /products/:id when not found', async () => {
    const actor = buildActor();
    const prisma = buildPrisma({ actor, products: [] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'PATCH',
      url: '/products/missing',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { name: 'x' },
    });
    const body = response.json();

    expect(response.statusCode).toBe(404);
    expect(body.error.code).toBe('PRODUCT_NOT_FOUND');

    await server.close();
  });

  // ── POST /products/:id/inbound ─────────────────────────────────────────────

  it('processes inbound and returns 201', async () => {
    const actor = buildActor();
    const product = buildStoredProduct();
    const movement = buildStoredMovement();
    const prisma = buildPrisma({ actor, products: [product], createdMovement: movement });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: `/products/${PRODUCT_ID}/inbound`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { quantity: 100 },
    });
    const body = response.json();

    expect(response.statusCode).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.data.type).toBe('INBOUND');

    await server.close();
  });

  it('returns 400 when inbound quantity is 0', async () => {
    const actor = buildActor();
    const product = buildStoredProduct();
    const prisma = buildPrisma({ actor, products: [product] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: `/products/${PRODUCT_ID}/inbound`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { quantity: 0 },
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body.error.code).toBe('INVALID_QUANTITY');

    await server.close();
  });

  it('returns 404 when product not found on inbound', async () => {
    const actor = buildActor();
    const prisma = buildPrisma({ actor, products: [] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/products/missing/inbound',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { quantity: 10 },
    });
    const body = response.json();

    expect(response.statusCode).toBe(404);
    expect(body.error.code).toBe('PRODUCT_NOT_FOUND');

    await server.close();
  });

  // ── POST /products/:id/adjust ──────────────────────────────────────────────

  it('processes adjust and returns 200', async () => {
    const actor = buildActor();
    const product = buildStoredProduct();
    const movement = buildStoredMovement({ type: 'ADJUSTMENT', quantity: -5 });
    const prisma = buildPrisma({ actor, products: [product], createdMovement: movement });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: `/products/${PRODUCT_ID}/adjust`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { quantity: -5, reason: '파손' },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.type).toBe('ADJUSTMENT');

    await server.close();
  });

  it('returns 400 when adjust quantity is 0', async () => {
    const actor = buildActor();
    const product = buildStoredProduct();
    const prisma = buildPrisma({ actor, products: [product] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: `/products/${PRODUCT_ID}/adjust`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { quantity: 0, reason: '테스트' },
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body.error.code).toBe('INVALID_QUANTITY');

    await server.close();
  });

  // ── Excel import/export routes ─────────────────────────────────────────────

  it('dry-runs Imweb XLSX uploads for OPERATIONS and returns warning evidence without DB writes', async () => {
    const actor = buildActor({ roles: ['OPERATIONS'] });
    const prisma = buildPrisma({ actor });
    const server = buildTestServer(prisma);
    await server.ready();
    const contentBase64 = workbookBase64([
      validImwebExcelRow({ 상품번호: '6571', 카테고리ID: 'CATE999', 판매가: '가격없음' }),
    ]);

    const response = await server.inject({
      method: 'POST',
      url: '/products/import/dry-run',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: {
        fileName: 'imweb-products.xlsx',
        contentBase64,
        sizeBytes: Buffer.byteLength(contentBase64, 'base64'),
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.summary.totalRows).toBe(1);
    expect(body.data.items[0].warningCodes).toEqual(expect.arrayContaining(['CATEGORY_FALLBACK_GOODS', 'MISSING_PRICE']));
    expect(body.data.items[0].reviewRequired).toBe(true);
    expect(prisma.product.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('rejects SALES from Imweb XLSX dry-run', async () => {
    const actor = buildActor({ roles: ['SALES'] });
    const prisma = buildPrisma({ actor });
    const server = buildTestServer(prisma);
    await server.ready();
    const contentBase64 = workbookBase64([validImwebExcelRow()]);

    const response = await server.inject({
      method: 'POST',
      url: '/products/import/dry-run',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: {
        fileName: 'imweb-products.xlsx',
        contentBase64,
        sizeBytes: Buffer.byteLength(contentBase64, 'base64'),
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(403);
    expect(body.error.code).toBe('AUTHORIZATION_ERROR');

    await server.close();
  });

  it('keeps Excel import commit as an explicit disabled gate', async () => {
    const actor = buildActor({ roles: ['FINANCE'] });
    const prisma = buildPrisma({ actor });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/products/import/commit',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { batchId: 'dryrun_1' },
    });
    const body = response.json();

    expect(response.statusCode).toBe(403);
    expect(body.error.code).toBe('COMMIT_DISABLED');

    await server.close();
  });

  it('exports selected products as base64 XLSX with a parseable Imweb sheet', async () => {
    const actor = buildActor();
    const product = buildStoredProduct({
      id: 'KODY-PROD-000001',
      name: 'Album A',
      labelName: 'BELIFT LAB',
      releaseDateText: '2026-04-30',
      weightG: 65,
      stockManaged: true,
      saleStatus: 'ON_SALE',
      isDisplayed: true,
      sourceCategoryCodes: ['CATE70'],
      categoryReviewStatus: 'MAPPED',
    });
    product.sku = 'YP0885';
    product.barcode = '8809704435086';
    product.stockOnHand = 14;
    const prisma = buildPrisma({ actor, products: [product] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/products/export/imweb',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { productIds: ['KODY-PROD-000001'] },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.contentType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const workbook = XLSX.read(Buffer.from(body.data.contentBase64, 'base64'), { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['상품'], { defval: '' });
    expect(rows[0]).toMatchObject({ 상품번호: 'KODY-PROD-000001', 상품명: 'Album A', 브랜드: 'BELIFT LAB', 원산지: '8809704435086', 무게: 0.065 });

    await server.close();
  });

  it('rejects SALES from selected Imweb export', async () => {
    const actor = buildActor({ id: 'user_sales', roles: ['SALES'] });
    const prisma = buildPrisma({ actor });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/products/export/imweb',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { productIds: [PRODUCT_ID] },
    });
    const body = response.json();

    expect(response.statusCode).toBe(403);
    expect(body.error.code).toBe('AUTHORIZATION_ERROR');

    await server.close();
  });

  it('rejects Imweb export selections over the server cap', async () => {
    const actor = buildActor();
    const prisma = buildPrisma({ actor });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/products/export/imweb',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { productIds: Array.from({ length: 501 }, (_, index) => `KODY-PROD-${index}`) },
    });
    const body = response.json();

    expect(response.statusCode).toBe(413);
    expect(body.error.code).toBe('SELECTION_LIMIT_EXCEEDED');

    await server.close();
  });

  // ── GET /products/:id/movements ────────────────────────────────────────────

  it('returns movement list on GET /products/:id/movements', async () => {
    const actor = buildActor();
    const product = buildStoredProduct();
    const movements = [buildStoredMovement(), buildStoredMovement({ id: 'mov_2', type: 'ADJUSTMENT', quantity: -3 })];
    const prisma = buildPrisma({ actor, products: [product], movements });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: `/products/${PRODUCT_ID}/movements`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(2);

    await server.close();
  });
});

// ── Fixtures ──────────────────────────────────────────────────────────────

function workbookBase64(rows: Record<string, unknown>[]): string {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), '상품');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return buffer.toString('base64');
}

function validImwebExcelRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    상품번호: '6571',
    상품명: 'ILLIT - Album',
    카테고리ID: 'CATE70,CATE65',
    판매상태: '판매중',
    진열상태: 'Y',
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
    ...overrides,
  };
}

function validCreatePayload(overrides: Partial<Record<string, unknown>> = {}) {
  const payload: Record<string, unknown> = {
    artistId: ARTIST_ID,
    category: 'ALBUM' as ProductCategory,
    name: 'Standard Album',
    weightG: 150,
    priceKRW: 15000,
    ...overrides,
  };
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined) delete payload[key];
  }
  return payload;
}

function issueToken(userId: string, roles: Role[]): string {
  return issueAccessToken(
    { sub: userId, email: `${userId}@kody.test`, roles },
    'test-secret',
  ).token;
}

interface ActorInput { id?: string; roles?: Role[]; status?: UserStatus }

function buildActor(input: ActorInput = {}) {
  const id = input.id ?? 'admin_1';
  const roles = input.roles ?? ['ADMIN'];
  const status: UserStatus = input.status ?? 'ACTIVE';
  return {
    id, employeeId: `${id}_emp`, email: `${id}@kody.test`,
    passwordHash: 'unused', displayName: `User ${id}`,
    profileImageUrl: null, status,
    failedLoginCount: 0, lockedUntil: null, lastLoginAt: null,
    createdAt: new Date('2026-05-27T00:00:00Z'),
    updatedAt: new Date('2026-05-27T00:00:00Z'),
    roles: roles.map((role) => ({ role })),
    employee: { id: `${id}_emp`, name: `Emp ${id}`, email: `${id}@kody.test`, phone: null, department: null, position: null, status: 'ACTIVE' },
  };
}

function buildStoredArtist(overrides: Partial<{ id: string; name: string }> = {}) {
  return {
    id: overrides.id ?? ARTIST_ID,
    name: overrides.name ?? 'ATEZ',
    memberCount: 5,
    createdAt: new Date('2026-05-27T00:00:00Z'),
  };
}

function buildStoredProduct(overrides: Partial<{
  id: string; name: string; artistId: string | null; category: ProductCategory | null; weightG: number | null;
  labelName: string | null; releaseDateText: string | null; stockManaged: boolean; saleStatus: ProductSaleStatus;
  isDisplayed: boolean; categoryMappingSource: CategoryMappingSource; sourceCategoryCodes: string[];
  categoryReviewStatus: CategoryReviewStatus; thumbnailUrl: string | null; detailHtml: string | null;
}> = {}) {
  return {
    id: overrides.id ?? PRODUCT_ID,
    artistId: overrides.artistId === undefined ? ARTIST_ID : overrides.artistId,
    category: overrides.category === undefined ? 'ALBUM' as ProductCategory : overrides.category,
    name: overrides.name ?? 'Standard Album',
    labelName: overrides.labelName === undefined ? null : overrides.labelName,
    thumbnailUrl: overrides.thumbnailUrl === undefined ? null : overrides.thumbnailUrl,
    detailHtml: overrides.detailHtml === undefined ? null : overrides.detailHtml,
    releaseDateText: overrides.releaseDateText === undefined ? null : overrides.releaseDateText,
    weightG: overrides.weightG === undefined ? 150 : overrides.weightG,
    priceKRW: '15000.0000',
    priceStatus: 'CONFIRMED' as const,
    lastConfirmedPriceKRW: '15000.0000',
    lastConfirmedPriceAt: new Date('2026-05-27T00:00:00Z'),
    sourcePriceRaw: '15000',
    sku: null,
    barcode: null,
    avgPurchasePriceKRW: 12000,
    stockManaged: overrides.stockManaged ?? true,
    stockOnHand: 0,
    orderBasedStock: 0,
    shipmentBasedStock: 0,
    saleStatus: overrides.saleStatus ?? ('DRAFT' as ProductSaleStatus),
    isDisplayed: overrides.isDisplayed ?? false,
    categoryMappingSource: overrides.categoryMappingSource ?? ('EXACT' as CategoryMappingSource),
    sourceCategoryCodes: overrides.sourceCategoryCodes ?? [],
    categoryReviewStatus: overrides.categoryReviewStatus ?? ('PENDING' as CategoryReviewStatus),
    createdAt: new Date('2026-05-27T00:00:00Z'),
    updatedAt: new Date('2026-05-27T00:00:00Z'),
  };
}

function buildStoredMovement(overrides: Partial<{
  id: string; type: StockMovementType; quantity: number;
}> = {}) {
  return {
    id: overrides.id ?? 'mov_1',
    productId: PRODUCT_ID,
    type: (overrides.type ?? 'INBOUND') as StockMovementType,
    quantity: overrides.quantity ?? 100,
    reason: null,
    createdById: 'admin_1',
    createdAt: new Date('2026-05-27T00:00:00Z'),
  };
}

interface PrismaInput {
  actor: ReturnType<typeof buildActor>;
  artists?: ReturnType<typeof buildStoredArtist>[];
  products?: ReturnType<typeof buildStoredProduct>[];
  movements?: ReturnType<typeof buildStoredMovement>[];
  createdProduct?: ReturnType<typeof buildStoredProduct>;
  updatedProduct?: ReturnType<typeof buildStoredProduct>;
  createdMovement?: ReturnType<typeof buildStoredMovement>;
  nextProductSeq?: number;
}

function buildPrisma(input: PrismaInput) {
  const artists = input.artists ?? [];
  const products = input.products ?? [];
  const movements = input.movements ?? [];

  return {
    user: {
      findUnique: vi.fn(async (args: { where: { id: string } }) => {
        if (args.where.id === input.actor.id) return input.actor;
        return null;
      }),
    },
    artist: {
      create: vi.fn(async () => { throw new Error('not used'); }),
      findUnique: vi.fn(async (args: { where: { id: string } }) => {
        return artists.find((a) => a.id === args.where.id) ?? null;
      }),
      findMany: vi.fn(async () => artists),
    },
    product: {
      create: vi.fn(async () => {
        if (!input.createdProduct) throw new Error('createdProduct not provided');
        return input.createdProduct;
      }),
      findUnique: vi.fn(async (args: { where: { id?: string; sku?: string; barcode?: string } }) => {
        if (args.where.id) return products.find((p) => p.id === args.where.id) ?? null;
        return null;
      }),
      findFirst: vi.fn(async () => products[0] ?? null),
      findMany: vi.fn(async (args: { take?: number }) => {
        const take = args.take ?? products.length;
        return products.slice(0, take);
      }),
      update: vi.fn(async () => input.updatedProduct ?? products[0]),
    },
    productSequence: {
      upsert: vi.fn(async () => ({ key: 'KODY-PROD', lastSeq: input.nextProductSeq ?? 1 })),
    },
    productExternalMapping: {
      findUnique: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      create: vi.fn(async () => { throw new Error('not used'); }),
      update: vi.fn(async () => { throw new Error('not used'); }),
    },
    stockMovement: {
      create: vi.fn(async () => {
        if (!input.createdMovement) throw new Error('createdMovement not provided');
        return input.createdMovement;
      }),
      findMany: vi.fn(async () => movements),
    },
    refreshToken: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
    },
    actionLog: { create: vi.fn(async () => ({})) },
  };
}
