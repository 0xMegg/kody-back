import { describe, expect, it, vi } from 'vitest';
import * as XLSX from '@e965/xlsx';
import { issueAccessToken } from '@/domain/auth/tokens.js';
import type {
  CategoryMappingSource,
  CategoryReviewStatus,
  OrderStatus,
  ProductCategory,
  ProductPublicSaleWindowStatus,
  ProductSaleStatus,
  Role,
  ShipmentItemStatus,
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

  it('creates product with Imweb-style detailHtml and persists the editor HTML contract', async () => {
    const actor = buildActor();
    const detailHtml = '<p style="text-align: center;"><strong><span style="font-size: 24px;">PRE-ORDER DEADLINE</span></strong></p><p><img src="https://assets.kody.test/product-detail/draft/image.webp" style="width: 699px;"></p>';
    const product = buildStoredProduct({ id: 'KODY-PROD-000013', detailHtml });
    const prisma = buildPrisma({
      actor,
      artists: [buildStoredArtist()],
      createdProduct: product,
      nextProductSeq: 13,
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/products',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: validCreatePayload({ detailHtml }),
    });
    const body = response.json();

    expect(response.statusCode).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.data.detailHtml).toBe(detailHtml);
    expect(prisma.product.create.mock.calls[0][0].data).toMatchObject({ detailHtml });

    await server.close();
  });

  it('sanitizes editor detailHtml on POST /products and preserves the allowed contract while dropping disallowed style props', async () => {
    const actor = buildActor();
    const inputDetailHtml = '<div class="detail" style="display: block;"><p style="text-align: center; color: red;"><strong><span style="font-size: 24px;">TEXT</span></strong><br><img src="https://assets.kody.test/product-detail/image.webp" alt="cover" class="hero" style="width: 699px; background-image: url(javascript:alert(1));"></p></div>';
    const product = buildStoredProduct({ id: 'KODY-PROD-000014' });
    const prisma = buildPrisma({
      actor,
      artists: [buildStoredArtist()],
      createdProduct: product,
      nextProductSeq: 14,
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/products',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: validCreatePayload({ detailHtml: inputDetailHtml }),
    });

    expect(response.statusCode).toBe(201);
    const persistedDetailHtml = String(prisma.product.create.mock.calls[0][0].data.detailHtml);
    expect(persistedDetailHtml).toContain('<div');
    expect(persistedDetailHtml).toContain('<p');
    expect(persistedDetailHtml).toContain('<strong>');
    expect(persistedDetailHtml).toContain('<span');
    expect(persistedDetailHtml).toContain('<br>');
    expect(persistedDetailHtml).toContain('<img');
    expect(persistedDetailHtml).toContain('class="detail"');
    expect(persistedDetailHtml).toContain('alt="cover"');
    expect(persistedDetailHtml).toContain('text-align: center');
    expect(persistedDetailHtml).toContain('font-size: 24px');
    expect(persistedDetailHtml).toContain('width: 699px');
    expect(persistedDetailHtml).toContain('display: block');
    expect(persistedDetailHtml).not.toContain('color');
    expect(persistedDetailHtml).not.toContain('background-image');
    expect(persistedDetailHtml).not.toContain('url(');
    expect(persistedDetailHtml).not.toContain('javascript:');

    await server.close();
  });

  it('strips dangerous tags, attributes, and image URLs from detailHtml on POST /products', async () => {
    const actor = buildActor();
    const inputDetailHtml = '<p onclick="alert(1)" style="text-align: center; background-image: url(javascript:alert(1));">Hello <script>alert(1)</script><img src="javascript:alert(2)" onerror="alert(3)"><img src="http://example.test/bad.webp"><img src="/api/uploads/product-detail-images/local/a.webp" onload="alert(4)" alt="ok"></p>';
    const product = buildStoredProduct({ id: 'KODY-PROD-000015' });
    const prisma = buildPrisma({
      actor,
      artists: [buildStoredArtist()],
      createdProduct: product,
      nextProductSeq: 15,
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/products',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: validCreatePayload({ detailHtml: inputDetailHtml }),
    });

    expect(response.statusCode).toBe(201);
    const persistedDetailHtml = String(prisma.product.create.mock.calls[0][0].data.detailHtml);
    expect(persistedDetailHtml).not.toContain('<script');
    expect(persistedDetailHtml).not.toContain('onclick');
    expect(persistedDetailHtml).not.toContain('onerror');
    expect(persistedDetailHtml).not.toContain('onload');
    expect(persistedDetailHtml).not.toContain('javascript:');
    expect(persistedDetailHtml).not.toContain('background-image');
    expect(persistedDetailHtml).not.toContain('url(');
    expect(persistedDetailHtml).not.toContain('http://example.test');
    expect(persistedDetailHtml).toContain('src="/api/uploads/product-detail-images/local/a.webp"');
    expect(persistedDetailHtml).toContain('alt="ok"');

    await server.close();
  });

  it('persists thumbnailUrl on POST /products and returns it in the response', async () => {
    const actor = buildActor();
    const thumbnailUrl = 'https://assets.kody.test/product-detail/draft/thumb.webp';
    const product = buildStoredProduct({ id: 'KODY-PROD-000020', thumbnailUrl });
    const prisma = buildPrisma({
      actor,
      artists: [buildStoredArtist()],
      createdProduct: product,
      nextProductSeq: 20,
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/products',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: validCreatePayload({ thumbnailUrl }),
    });
    const body = response.json();

    expect(response.statusCode).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.data.thumbnailUrl).toBe(thumbnailUrl);
    expect(prisma.product.create.mock.calls[0][0].data).toMatchObject({ thumbnailUrl });

    await server.close();
  });

  it('accepts a local /api/uploads/product-detail-images thumbnailUrl on POST /products', async () => {
    const actor = buildActor();
    const thumbnailUrl = '/api/uploads/product-detail-images/local/product-detail%2Fdraft%2Fthumb.webp';
    const product = buildStoredProduct({ id: 'KODY-PROD-000021', thumbnailUrl });
    const prisma = buildPrisma({
      actor,
      artists: [buildStoredArtist()],
      createdProduct: product,
      nextProductSeq: 21,
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/products',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: validCreatePayload({ thumbnailUrl }),
    });
    const body = response.json();

    expect(response.statusCode).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.data.thumbnailUrl).toBe(thumbnailUrl);
    expect(prisma.product.create.mock.calls[0][0].data).toMatchObject({ thumbnailUrl });

    await server.close();
  });

  it('rejects unsafe javascript: thumbnailUrl on POST /products', async () => {
    const actor = buildActor();
    const prisma = buildPrisma({ actor, artists: [buildStoredArtist()] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/products',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: validCreatePayload({ thumbnailUrl: 'javascript:alert(1)' }),
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(prisma.product.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('creates product with initialStockOnHand and writes one initial inbound movement atomically', async () => {
    const actor = buildActor();
    const product = buildStoredProduct({ id: 'KODY-PROD-000011', stockOnHand: 12, orderBasedStock: 12, shipmentBasedStock: 12 });
    const movement = buildStoredMovement({ productId: 'KODY-PROD-000011', quantity: 12, previousQty: 0, newQty: 12 });
    const prisma = buildPrisma({
      actor,
      artists: [buildStoredArtist()],
      createdProduct: product,
      createdMovement: movement,
      nextProductSeq: 11,
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/products',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: validCreatePayload({ initialStockOnHand: 12 }),
    });
    const body = response.json();

    expect(response.statusCode).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.data.stockOnHand).toBe(12);
    expect(body.data.orderBasedStock).toBe(12);
    expect(body.data.shipmentBasedStock).toBe(12);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.product.create.mock.calls[0][0].data).toMatchObject({
      stockOnHand: 12,
      orderBasedStock: 12,
      shipmentBasedStock: 12,
    });
    expect(prisma.stockMovement.create.mock.calls).toHaveLength(1);
    expect(prisma.stockMovement.create.mock.calls[0][0].data).toMatchObject({
      productId: 'KODY-PROD-000011',
      type: 'INBOUND',
      quantity: 12,
      previousQty: 0,
      newQty: 12,
      reason: 'INITIAL_STOCK',
      createdById: actor.id,
    });

    await server.close();
  });

  it('creates product with zero initialStockOnHand without writing a fake movement', async () => {
    const actor = buildActor();
    const product = buildStoredProduct({ id: 'KODY-PROD-000012', stockOnHand: 0, orderBasedStock: 0, shipmentBasedStock: 0 });
    const prisma = buildPrisma({
      actor,
      artists: [buildStoredArtist()],
      createdProduct: product,
      nextProductSeq: 12,
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/products',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: validCreatePayload({ initialStockOnHand: 0 }),
    });

    expect(response.statusCode).toBe(201);
    expect(prisma.product.create.mock.calls[0][0].data).toMatchObject({
      stockOnHand: 0,
      orderBasedStock: 0,
      shipmentBasedStock: 0,
    });
    expect(prisma.stockMovement.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('rejects direct event-derived stock edits on Product create and update payloads', async () => {
    const actor = buildActor();
    const prisma = buildPrisma({ actor, artists: [buildStoredArtist()], products: [buildStoredProduct()] });
    const server = buildTestServer(prisma);
    await server.ready();

    const createResponse = await server.inject({
      method: 'POST',
      url: '/products',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: validCreatePayload({ orderBasedStock: 99 }),
    });
    const updateResponse = await server.inject({
      method: 'PATCH',
      url: `/products/${PRODUCT_ID}`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { shipmentBasedStock: 99 },
    });

    expect(createResponse.statusCode).toBe(400);
    expect(createResponse.json().error.message).toContain('orderBasedStock cannot be set directly');
    expect(updateResponse.statusCode).toBe(400);
    expect(updateResponse.json().error.message).toContain('shipmentBasedStock cannot be set directly');
    expect(prisma.product.create).not.toHaveBeenCalled();
    expect(prisma.product.update).not.toHaveBeenCalled();

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

  it('allows duplicate barcode on POST /products since SKU is the only blocking uniqueness check', async () => {
    const actor = buildActor();
    const existingProduct = buildStoredProduct({
      id: 'KODY-PROD-000099',
      sku: null,
      barcode: '8809704435086',
    });
    const createdProduct = buildStoredProduct({
      id: 'KODY-PROD-000100',
      sku: null,
      barcode: '8809704435086',
    });
    const prisma = buildPrisma({
      actor,
      artists: [buildStoredArtist()],
      products: [existingProduct],
      createdProduct,
      nextProductSeq: 100,
    });
    prisma.product.findFirst = vi.fn(async (args: { where: { sku?: string; barcode?: string } }) => {
      if (args.where.sku !== undefined) {
        return existingProduct.sku === args.where.sku ? existingProduct : null;
      }
      if (args.where.barcode !== undefined) {
        return existingProduct.barcode === args.where.barcode ? existingProduct : null;
      }
      return null;
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/products',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: validCreatePayload({ barcode: '8809704435086' }),
    });

    expect(response.statusCode).toBe(201);

    await server.close();
  });

  it('rejects duplicate SKU on POST /products as DUPLICATE_SKU', async () => {
    const actor = buildActor();
    const existingProduct = buildStoredProduct({ id: 'KODY-PROD-000099', sku: 'YP0885' });
    const prisma = buildPrisma({ actor, artists: [buildStoredArtist()], products: [existingProduct] });
    prisma.product.findFirst = vi.fn(async (args: { where: { sku?: string; barcode?: string } }) => {
      if (args.where.sku !== undefined) {
        return existingProduct.sku === args.where.sku ? existingProduct : null;
      }
      if (args.where.barcode !== undefined) {
        return existingProduct.barcode === args.where.barcode ? existingProduct : null;
      }
      return null;
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/products',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: validCreatePayload({ sku: 'YP0885' }),
    });
    const body = response.json();

    expect(response.statusCode).toBe(409);
    expect(body.error.code).toBe('DUPLICATE_SKU');

    await server.close();
  });



  it('creates product with G4c taxonomy minor and itemType fields', async () => {
    const actor = buildActor();
    const product = buildStoredProduct({
      id: 'KODY-PROD-000020',
      category: 'GOODS',
      categoryMinor: 'OFFICIAL_GOODS',
      itemType: 'PHOTO_CARD',
    });
    const prisma = buildPrisma({
      actor,
      artists: [buildStoredArtist()],
      createdProduct: product,
      nextProductSeq: 20,
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/products',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: validCreatePayload({
        category: 'GOODS',
        categoryMinor: 'OFFICIAL_GOODS',
        itemType: 'PHOTO_CARD',
      }),
    });
    const body = response.json();

    expect(response.statusCode).toBe(201);
    expect(body.data.category).toBe('GOODS');
    expect(body.data.categoryMinor).toBe('OFFICIAL_GOODS');
    expect(body.data.itemType).toBe('PHOTO_CARD');
    expect(prisma.product.create.mock.calls[0][0].data).toMatchObject({
      category: 'GOODS',
      categoryMinor: 'OFFICIAL_GOODS',
      itemType: 'PHOTO_CARD',
    });

    await server.close();
  });

  it('rejects invalid G4c taxonomy combinations on POST /products', async () => {
    const actor = buildActor();
    const prisma = buildPrisma({ actor, artists: [buildStoredArtist()] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/products',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: validCreatePayload({
        category: 'ALBUM',
        categoryMinor: 'OFFICIAL_GOODS',
        itemType: 'PHOTO_CARD',
      }),
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(prisma.product.create).not.toHaveBeenCalled();

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



  it('passes G4c taxonomy filters to the product service on GET /products', async () => {
    const actor = buildActor({ roles: ['SALES'] });
    const prisma = buildPrisma({ actor, products: [buildStoredProduct({ category: 'GOODS', categoryMinor: 'OFFICIAL_GOODS', itemType: 'PHOTO_CARD' })] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/products?category=GOODS&categoryMinor=OFFICIAL_GOODS&itemType=PHOTO_CARD',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });

    expect(response.statusCode).toBe(200);
    expect(prisma.product.findMany.mock.calls[0][0].where).toMatchObject({
      category: 'GOODS',
      categoryMinor: 'OFFICIAL_GOODS',
      itemType: 'PHOTO_CARD',
    });

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

  it('rejects PATCH /products/:id when clearing category would leave stale minor/itemType taxonomy', async () => {
    const actor = buildActor();
    const product = buildStoredProduct({
      category: 'GOODS',
      categoryMinor: 'OFFICIAL_GOODS',
      itemType: 'MD',
    });
    const prisma = buildPrisma({ actor, products: [product] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'PATCH',
      url: `/products/${PRODUCT_ID}`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { category: null },
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(prisma.product.update).not.toHaveBeenCalled();

    await server.close();
  });

  it('updates and clears detailHtml on PATCH /products/:id', async () => {
    const actor = buildActor();
    const product = buildStoredProduct({ detailHtml: '<p>Old detail</p>' });
    const updated = buildStoredProduct({ detailHtml: null });
    const prisma = buildPrisma({ actor, products: [product], updatedProduct: updated });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'PATCH',
      url: `/products/${PRODUCT_ID}`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { detailHtml: null },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.detailHtml).toBeNull();
    expect(prisma.product.update.mock.calls[0][0].data).toMatchObject({ detailHtml: null });

    await server.close();
  });

  it('sanitizes detailHtml on PATCH /products/:id and records the sanitized value in the audit log', async () => {
    const actor = buildActor();
    const product = buildStoredProduct({ detailHtml: '<p>Old detail</p>' });
    const inputDetailHtml = '<p onclick="alert(1)">Updated<img src="javascript:alert(1)" onerror="alert(2)"><img src="https://assets.kody.test/safe.webp" style="width: 100px; behavior: url(x);"></p>';
    const updated = buildStoredProduct({ detailHtml: '<p>Updated<img src="https://assets.kody.test/safe.webp" style="width: 100px;"></p>' });
    const prisma = buildPrisma({ actor, products: [product], updatedProduct: updated });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'PATCH',
      url: `/products/${PRODUCT_ID}`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { detailHtml: inputDetailHtml },
    });

    expect(response.statusCode).toBe(200);
    const persistedDetailHtml = String(prisma.product.update.mock.calls[0][0].data.detailHtml);
    expect(persistedDetailHtml).not.toContain('onclick');
    expect(persistedDetailHtml).not.toContain('onerror');
    expect(persistedDetailHtml).not.toContain('javascript:');
    expect(persistedDetailHtml).not.toContain('behavior');
    expect(persistedDetailHtml).toContain('https://assets.kody.test/safe.webp');
    expect(persistedDetailHtml).toContain('width: 100px');

    const auditAfter = prisma.actionLog.create.mock.calls[0][0].data.afterJson as { detailHtml: string };
    expect(auditAfter.detailHtml).toBe(persistedDetailHtml);
    expect(auditAfter.detailHtml).not.toBe(inputDetailHtml);

    await server.close();
  });

  it('updates thumbnailUrl on PATCH /products/:id and writes audit before/after', async () => {
    const actor = buildActor();
    const product = buildStoredProduct({ thumbnailUrl: 'https://assets.kody.test/product-detail/old/thumb.webp' });
    const nextThumbnailUrl = 'https://assets.kody.test/product-detail/new/thumb.webp';
    const updated = buildStoredProduct({ thumbnailUrl: nextThumbnailUrl });
    const prisma = buildPrisma({ actor, products: [product], updatedProduct: updated });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'PATCH',
      url: `/products/${PRODUCT_ID}`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { thumbnailUrl: nextThumbnailUrl },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.thumbnailUrl).toBe(nextThumbnailUrl);
    expect(prisma.product.update.mock.calls[0][0].data).toMatchObject({ thumbnailUrl: nextThumbnailUrl });
    expect(prisma.actionLog.create.mock.calls[0][0].data).toMatchObject({
      actionType: 'PRODUCT_UPDATE',
      beforeJson: { thumbnailUrl: 'https://assets.kody.test/product-detail/old/thumb.webp' },
      afterJson: { thumbnailUrl: nextThumbnailUrl },
    });

    await server.close();
  });

  it('clears thumbnailUrl on PATCH /products/:id when null is sent', async () => {
    const actor = buildActor();
    const product = buildStoredProduct({ thumbnailUrl: 'https://assets.kody.test/product-detail/old/thumb.webp' });
    const updated = buildStoredProduct({ thumbnailUrl: null });
    const prisma = buildPrisma({ actor, products: [product], updatedProduct: updated });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'PATCH',
      url: `/products/${PRODUCT_ID}`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { thumbnailUrl: null },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.thumbnailUrl).toBeNull();
    expect(prisma.product.update.mock.calls[0][0].data).toMatchObject({ thumbnailUrl: null });

    await server.close();
  });

  it('rejects unsafe javascript: thumbnailUrl on PATCH /products/:id', async () => {
    const actor = buildActor();
    const product = buildStoredProduct({ thumbnailUrl: null });
    const prisma = buildPrisma({ actor, products: [product] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'PATCH',
      url: `/products/${PRODUCT_ID}`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { thumbnailUrl: 'javascript:alert(1)' },
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(prisma.product.update).not.toHaveBeenCalled();

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

  // ── PATCH /products/:id/public-sale-window ────────────────────────────────

  it('allows ADMIN to approve a product public sale-window with UTC persistence and audit metadata only', async () => {
    const actor = buildActor({ roles: ['ADMIN'] });
    const product = buildStoredProduct({
      publicSaleStartsAt: null,
      publicSaleEndsAt: null,
      publicSaleWindowStatus: 'DRAFT',
      publicSaleWindowUpdatedByUserId: null,
      publicSaleWindowUpdatedAt: null,
    });
    const prisma = buildPrisma({ actor, products: [product] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'PATCH',
      url: `/products/${PRODUCT_ID}/public-sale-window`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: {
        publicSaleStartsAt: '2026-07-01T09:00:00+09:00',
        publicSaleEndsAt: '2026-07-07T18:00:00+09:00',
        publicSaleWindowStatus: 'APPROVED',
        reason: 'homepage preorder calendar approved by MD',
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.publicSaleStartsAt).toBe('2026-07-01T00:00:00.000Z');
    expect(body.data.publicSaleEndsAt).toBe('2026-07-07T09:00:00.000Z');
    expect(body.data.publicSaleWindowStatus).toBe('APPROVED');
    expect(body.data.publicSaleWindowUpdatedByUserId).toBe(actor.id);
    expect(body.data.publicSaleWindowUpdatedAt).toEqual(expect.any(String));

    const updateData = prisma.product.update.mock.calls[0][0].data;
    expect(updateData).toMatchObject({
      publicSaleStartsAt: new Date('2026-07-01T00:00:00.000Z'),
      publicSaleEndsAt: new Date('2026-07-07T09:00:00.000Z'),
      publicSaleWindowStatus: 'APPROVED',
      publicSaleWindowUpdatedByUserId: actor.id,
    });
    expect(updateData).not.toHaveProperty('reason');
    expect(prisma.productVariant.findMany).not.toHaveBeenCalled();
    expect(prisma.productVariant.create).not.toHaveBeenCalled();
    expect(prisma.productVariant.update).not.toHaveBeenCalled();
    expect(prisma.productVariant.deleteMany).not.toHaveBeenCalled();

    expect(prisma.actionLog.create.mock.calls[0][0].data).toMatchObject({
      actionType: 'PRODUCT_UPDATE',
      targetType: 'Product',
      targetId: PRODUCT_ID,
      beforeJson: {
        publicSaleStartsAt: null,
        publicSaleEndsAt: null,
        publicSaleWindowStatus: 'DRAFT',
        publicSaleWindowUpdatedByUserId: null,
        publicSaleWindowUpdatedAt: null,
      },
      afterJson: {
        publicSaleStartsAt: new Date('2026-07-01T00:00:00.000Z'),
        publicSaleEndsAt: new Date('2026-07-07T09:00:00.000Z'),
        publicSaleWindowStatus: 'APPROVED',
        publicSaleWindowUpdatedByUserId: actor.id,
        publicSaleWindowUpdatedAt: expect.any(Date),
      },
      metadataJson: {
        source: 'manual_oms',
        reason: 'homepage preorder calendar approved by MD',
        scope: 'product_public_sale_window',
      },
    });

    await server.close();
  });

  it('preserves existing public sale-window dates when omitted from dedicated PATCH', async () => {
    const actor = buildActor({ roles: ['ADMIN'] });
    const product = buildStoredProduct({
      publicSaleStartsAt: new Date('2026-07-01T00:00:00.000Z'),
      publicSaleEndsAt: new Date('2026-07-07T09:00:00.000Z'),
      publicSaleWindowStatus: 'APPROVED',
      publicSaleWindowUpdatedByUserId: 'previous_admin',
      publicSaleWindowUpdatedAt: new Date('2026-06-30T00:00:00.000Z'),
    });
    const prisma = buildPrisma({ actor, products: [product] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'PATCH',
      url: `/products/${PRODUCT_ID}/public-sale-window`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: {
        publicSaleWindowStatus: 'CANCELLED',
        reason: 'cancelled by merchandising team',
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.data.publicSaleStartsAt).toBe('2026-07-01T00:00:00.000Z');
    expect(body.data.publicSaleEndsAt).toBe('2026-07-07T09:00:00.000Z');
    expect(prisma.product.update.mock.calls[0][0].data).toMatchObject({
      publicSaleStartsAt: new Date('2026-07-01T00:00:00.000Z'),
      publicSaleEndsAt: new Date('2026-07-07T09:00:00.000Z'),
      publicSaleWindowStatus: 'CANCELLED',
      publicSaleWindowUpdatedByUserId: actor.id,
    });

    await server.close();
  });

  it('allows FINANCE but rejects OPERATIONS from product public sale-window writes', async () => {
    const product = buildStoredProduct();

    const finance = buildActor({ id: 'finance_1', roles: ['FINANCE'] });
    const financePrisma = buildPrisma({ actor: finance, products: [product] });
    const financeServer = buildTestServer(financePrisma);
    await financeServer.ready();

    const financeResponse = await financeServer.inject({
      method: 'PATCH',
      url: `/products/${PRODUCT_ID}/public-sale-window`,
      headers: { authorization: `Bearer ${issueToken(finance.id, finance.roles)}` },
      payload: { publicSaleWindowStatus: 'DRAFT' },
    });

    expect(financeResponse.statusCode).toBe(200);
    await financeServer.close();

    const operations = buildActor({ id: 'ops_1', roles: ['OPERATIONS'] });
    const operationsPrisma = buildPrisma({ actor: operations, products: [product] });
    const operationsServer = buildTestServer(operationsPrisma);
    await operationsServer.ready();

    const operationsResponse = await operationsServer.inject({
      method: 'PATCH',
      url: `/products/${PRODUCT_ID}/public-sale-window`,
      headers: { authorization: `Bearer ${issueToken(operations.id, operations.roles)}` },
      payload: { publicSaleWindowStatus: 'DRAFT' },
    });

    expect(operationsResponse.statusCode).toBe(403);
    expect(operationsResponse.json().error.code).toBe('AUTHORIZATION_ERROR');
    expect(operationsPrisma.product.update).not.toHaveBeenCalled();
    await operationsServer.close();
  });

  it('requires reason for APPROVED/CANCELLED and enforces [start,end) product public sale-window validation', async () => {
    const actor = buildActor();
    const product = buildStoredProduct();
    const prisma = buildPrisma({ actor, products: [product] });
    const server = buildTestServer(prisma);
    await server.ready();

    const missingReason = await server.inject({
      method: 'PATCH',
      url: `/products/${PRODUCT_ID}/public-sale-window`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: {
        publicSaleStartsAt: '2026-07-01T00:00:00.000Z',
        publicSaleWindowStatus: 'APPROVED',
      },
    });
    expect(missingReason.statusCode).toBe(400);
    expect(missingReason.json().error.code).toBe('VALIDATION_ERROR');

    const invalidWindow = await server.inject({
      method: 'PATCH',
      url: `/products/${PRODUCT_ID}/public-sale-window`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: {
        publicSaleStartsAt: '2026-07-01T00:00:00.000Z',
        publicSaleEndsAt: '2026-07-01T00:00:00.000Z',
        publicSaleWindowStatus: 'DRAFT',
      },
    });
    expect(invalidWindow.statusCode).toBe(400);
    expect(invalidWindow.json().error.code).toBe('VALIDATION_ERROR');
    expect(prisma.product.update).not.toHaveBeenCalled();
    expect(prisma.actionLog.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('rejects generic PATCH /products/:id attempts to mutate product public sale-window fields', async () => {
    const actor = buildActor();
    const product = buildStoredProduct();
    const prisma = buildPrisma({ actor, products: [product] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'PATCH',
      url: `/products/${PRODUCT_ID}`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: {
        name: 'Updated Album',
        publicSaleStartsAt: '2026-07-01T00:00:00.000Z',
        publicSaleWindowStatus: 'APPROVED',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    expect(prisma.product.update).not.toHaveBeenCalled();

    await server.close();
  });

  // ── POST /products/:id/inbound ─────────────────────────────────────────────

  it('processes inbound and returns 201', async () => {
    const actor = buildActor();
    const product = buildStoredProduct({ stockOnHand: 14 });
    const movement = buildStoredMovement({ previousQty: 14, newQty: 114 });
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
    expect(body.data.previousQty).toBe(14);
    expect(body.data.newQty).toBe(114);
    expect(prisma.stockMovement.create.mock.calls[0][0].data).toMatchObject({
      previousQty: 14,
      newQty: 114,
    });

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
    const product = buildStoredProduct({ stockOnHand: 14 });
    const movement = buildStoredMovement({ type: 'ADJUSTMENT', quantity: -5, previousQty: 14, newQty: 9 });
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
    expect(body.data.previousQty).toBe(14);
    expect(body.data.newQty).toBe(9);
    expect(prisma.stockMovement.create.mock.calls[0][0].data).toMatchObject({
      previousQty: 14,
      newQty: 9,
    });

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
    expect(body.data.items[0].warningCodes).toEqual(expect.arrayContaining(['CATEGORY_UNMAPPED', 'MISSING_PRICE']));
    expect(body.data.items[0].reviewRequired).toBe(true);
    expect(prisma.product.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('rejects forbidden workbook extensions through the HTTP dry-run route as validation errors', async () => {
    const actor = buildActor({ roles: ['OPERATIONS'] });
    const prisma = buildPrisma({ actor });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/products/import/dry-run',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: {
        fileName: 'imweb-products.xlsm',
        contentBase64: Buffer.from('not a zip file').toString('base64'),
        sizeBytes: 14,
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('Only .xlsx uploads are allowed');
    expect(prisma.product.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('ignores hidden write flags on dry-run uploads and never calls product/mapping writes', async () => {
    const actor = buildActor({ roles: ['OPERATIONS'] });
    const prisma = buildPrisma({ actor });
    const server = buildTestServer(prisma);
    await server.ready();
    const contentBase64 = workbookBase64([validImwebExcelRow({ 상품번호: '6571', 판매가: '17440' })]);

    const response = await server.inject({
      method: 'POST',
      url: '/products/import/dry-run?commit=true&write=true&import=true',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: {
        fileName: 'imweb-products.xlsx',
        contentBase64,
        sizeBytes: Buffer.byteLength(contentBase64, 'base64'),
        commit: true,
        write: true,
        import: true,
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.summary).toMatchObject({ totalRows: 1, create: 1, update: 0 });
    expect(prisma.product.create).not.toHaveBeenCalled();
    expect(prisma.product.update).not.toHaveBeenCalled();
    expect(prisma.productExternalMapping.create).not.toHaveBeenCalled();
    expect(prisma.productExternalMapping.update).not.toHaveBeenCalled();

    await server.close();
  });

  it('marks dry-run rows as updates and search-aid warnings against existing OMS products', async () => {
    const actor = buildActor({ roles: ['OPERATIONS'] });
    const existingProduct = buildStoredProduct({
      id: 'KODY-PROD-000099',
      sku: 'YP0885',
      barcode: '8809704435086',
    });
    const existingMapping = buildStoredExternalMapping({
      productId: existingProduct.id,
      externalProductId: '6571',
    });
    const prisma = buildPrisma({ actor, products: [existingProduct], externalMappings: [existingMapping] });
    const server = buildTestServer(prisma);
    await server.ready();
    const contentBase64 = workbookBase64([validImwebExcelRow({ 상품번호: '6571' })]);

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
    expect(body.data.summary).toMatchObject({ totalRows: 1, update: 1, create: 0 });
    expect(body.data.items[0].status).toBe('update');
    expect(body.data.items[0].warningCodes).toEqual(expect.arrayContaining(['EXISTING_SKU', 'EXISTING_BARCODE']));
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

  it('keeps disabled Imweb commit route read-only even when a commit payload is supplied', async () => {
    const actor = buildActor({ roles: ['ADMIN'] });
    const prisma = buildPrisma({ actor });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/products/import/commit',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: {
        batchId: 'dryrun_1',
        commit: true,
        write: true,
        import: true,
        items: [{ externalProductId: '6571' }],
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(403);
    expect(body.error.code).toBe('COMMIT_DISABLED');
    expect(prisma.product.create).not.toHaveBeenCalled();
    expect(prisma.product.update).not.toHaveBeenCalled();
    expect(prisma.productExternalMapping.create).not.toHaveBeenCalled();
    expect(prisma.productExternalMapping.update).not.toHaveBeenCalled();
    expect(prisma.stockMovement.create).not.toHaveBeenCalled();
    expect(prisma.actionLog.create).not.toHaveBeenCalled();

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

  // ── POST /products/external-mappings/correct ───────────────────────────────

  it('allows ADMIN to REMAP an external mapping with evidence and audit log', async () => {
    const actor = buildActor({ roles: ['ADMIN'] });
    const mapping = buildStoredExternalMapping({ productId: 'KODY-PROD-OLD' });
    const remapped = buildStoredExternalMapping({ productId: 'KODY-PROD-NEW' });
    const targetProduct = buildStoredProduct({ id: 'KODY-PROD-NEW' });
    const prisma = buildPrisma({ actor, products: [targetProduct], externalMappings: [mapping] });
    prisma.productExternalMapping.findUnique = vi.fn(async (args: { where: { id?: string } }) => {
      if (args.where.id === mapping.id) return mapping;
      return null;
    });
    prisma.productExternalMapping.update = vi.fn(async () => remapped);
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/products/external-mappings/correct',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: {
        mappingId: mapping.id,
        operation: 'REMAP',
        newProductId: 'KODY-PROD-NEW',
        evidenceUrl: 'https://evidence.example/ticket/123',
        reason: 'wrong initial import mapping',
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.mapping.productId).toBe('KODY-PROD-NEW');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.productExternalMapping.update.mock.calls[0][0]).toMatchObject({
      where: { id: mapping.id },
      data: { productId: 'KODY-PROD-NEW' },
    });
    expect(prisma.actionLog.create.mock.calls[0][0].data).toMatchObject({
      actorUserId: actor.id,
      actionType: 'PRODUCT_EXTERNAL_MAPPING_CORRECTED',
      targetType: 'ProductExternalMapping',
      targetId: mapping.id,
      metadataJson: {
        operation: 'REMAP',
        evidenceUrl: 'https://evidence.example/ticket/123',
        reason: 'wrong initial import mapping',
        sourceSystem: 'IMWEB_KR',
        externalProductId: '6571',
      },
    });

    await server.close();
  });

  it('forbids OPERATIONS from executing external mapping correction', async () => {
    const actor = buildActor({ roles: ['OPERATIONS'] });
    const prisma = buildPrisma({ actor });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/products/external-mappings/correct',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: {
        mappingId: 'mapping_1',
        operation: 'DETACH',
        evidenceUrl: 'https://evidence.example/ticket/124',
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(403);
    expect(body.error.code).toBe('AUTHORIZATION_ERROR');
    expect(prisma.productExternalMapping.update).not.toHaveBeenCalled();

    await server.close();
  });

  // ── GET /products/:id/movements ────────────────────────────────────────────

  it('returns movement list on GET /products/:id/movements', async () => {
    const actor = buildActor();
    const product = buildStoredProduct();
    const movements = [
      buildStoredMovement({ previousQty: 0, newQty: 100 }),
      buildStoredMovement({ id: 'mov_2', type: 'ADJUSTMENT', quantity: -3, previousQty: 100, newQty: 97 }),
    ];
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
    expect(body.data[0]).toMatchObject({ previousQty: 0, newQty: 100 });
    expect(body.data[1]).toMatchObject({ previousQty: 100, newQty: 97 });

    await server.close();
  });

  // ── openOrderedQuantity read-only aggregate ────────────────────────────────

  it('exposes read-only openOrderedQuantity from confirmed unfulfilled order items on GET /products/:id', async () => {
    const actor = buildActor();
    const product = buildStoredProduct({ stockOnHand: 30, orderBasedStock: 25, shipmentBasedStock: 5 });
    const orderItems = [
      { productId: PRODUCT_ID, quantity: 10, shipmentStatus: 'NOT_SHIPPED' as ShipmentItemStatus, orderStatus: 'CONFIRMED' as OrderStatus },
      { productId: PRODUCT_ID, quantity: 4, shipmentStatus: 'PENDING' as ShipmentItemStatus, orderStatus: 'CONFIRMED' as OrderStatus },
      // shipped/completed item is excluded from the open aggregate
      { productId: PRODUCT_ID, quantity: 7, shipmentStatus: 'COMPLETED' as ShipmentItemStatus, orderStatus: 'CONFIRMED' as OrderStatus },
      // PENDING order is excluded
      { productId: PRODUCT_ID, quantity: 9, shipmentStatus: 'NOT_SHIPPED' as ShipmentItemStatus, orderStatus: 'PENDING' as OrderStatus },
      // SUSPENDED order is excluded
      { productId: PRODUCT_ID, quantity: 3, shipmentStatus: 'NOT_SHIPPED' as ShipmentItemStatus, orderStatus: 'SUSPENDED' as OrderStatus },
    ];
    const prisma = buildPrisma({ actor, products: [product], orderItems });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: `/products/${PRODUCT_ID}`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.data.openOrderedQuantity).toBe(14);
    // existing event-derived stock counters remain present alongside the new aggregate
    expect(body.data.stockOnHand).toBe(30);
    expect(body.data.orderBasedStock).toBe(25);
    expect(body.data.shipmentBasedStock).toBe(5);

    await server.close();
  });

  it('aggregates openOrderedQuantity per product on GET /products', async () => {
    const actor = buildActor();
    const products = [
      buildStoredProduct({ id: 'P-ATEZ-001' }),
      buildStoredProduct({ id: 'P-ATEZ-002' }),
    ];
    const orderItems = [
      { productId: 'P-ATEZ-001', quantity: 5, shipmentStatus: 'NOT_SHIPPED' as ShipmentItemStatus, orderStatus: 'CONFIRMED' as OrderStatus },
      { productId: 'P-ATEZ-001', quantity: 2, shipmentStatus: 'PENDING' as ShipmentItemStatus, orderStatus: 'CONFIRMED' as OrderStatus },
      { productId: 'P-ATEZ-002', quantity: 8, shipmentStatus: 'NOT_SHIPPED' as ShipmentItemStatus, orderStatus: 'CONFIRMED' as OrderStatus },
      { productId: 'P-ATEZ-002', quantity: 6, shipmentStatus: 'COMPLETED' as ShipmentItemStatus, orderStatus: 'CONFIRMED' as OrderStatus },
    ];
    const prisma = buildPrisma({ actor, products, orderItems });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/products',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    const byId = Object.fromEntries(
      body.data.items.map((item: { id: string; openOrderedQuantity: number }) => [item.id, item.openOrderedQuantity]),
    );
    expect(byId['P-ATEZ-001']).toBe(7);
    expect(byId['P-ATEZ-002']).toBe(8);

    await server.close();
  });

  it('defaults openOrderedQuantity to 0 when no confirmed open orders exist', async () => {
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
    expect(body.data.openOrderedQuantity).toBe(0);

    await server.close();
  });

  it('rejects direct openOrderedQuantity edits on Product create and update payloads', async () => {
    const actor = buildActor();
    const prisma = buildPrisma({ actor, artists: [buildStoredArtist()], products: [buildStoredProduct()] });
    const server = buildTestServer(prisma);
    await server.ready();

    const createResponse = await server.inject({
      method: 'POST',
      url: '/products',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: validCreatePayload({ openOrderedQuantity: 99 }),
    });
    const updateResponse = await server.inject({
      method: 'PATCH',
      url: `/products/${PRODUCT_ID}`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { openOrderedQuantity: 99 },
    });

    expect(createResponse.statusCode).toBe(400);
    expect(createResponse.json().error.message).toContain('openOrderedQuantity cannot be set directly');
    expect(updateResponse.statusCode).toBe(400);
    expect(updateResponse.json().error.message).toContain('openOrderedQuantity cannot be set directly');
    expect(prisma.product.create).not.toHaveBeenCalled();
    expect(prisma.product.update).not.toHaveBeenCalled();

    await server.close();
  });

  // ── Variants (A-1a) ─────────────────────────────────────────────────────────

  it('creates a product with variants and returns them in the create projection', async () => {
    const actor = buildActor();
    const product = buildStoredProduct({ id: 'KODY-PROD-000020' });
    const prisma = buildPrisma({
      actor,
      artists: [buildStoredArtist()],
      createdProduct: product,
      nextProductSeq: 20,
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/products',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: validCreatePayload({
        variants: [
          { name: 'MUSIC PLANET', priceKRW: 17000, sku: 'V-MP', optionValueIds: ['ov1', 'ov2'] },
          { name: 'KTOWN4U', priceKRW: 18000, saleStartAt: '2026-07-01T00:00:00.000Z', saleEndAt: '2026-07-31T00:00:00.000Z' },
        ],
      }),
    });
    const body = response.json();

    expect(response.statusCode).toBe(201);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.productVariant.create).toHaveBeenCalledTimes(2);
    expect(body.data.variants).toHaveLength(2);
    expect(body.data.variants[0]).toMatchObject({
      name: 'MUSIC PLANET',
      priceKRW: '17000.0000',
      effectivePriceKRW: '17000.0000',
      priceAuthority: 'VARIANT',
      sku: 'V-MP',
      effectiveSku: 'V-MP',
      skuInherited: false,
      optionValueIds: ['ov1', 'ov2'],
      position: 0,
    });
    expect(body.data.variants[1]).toMatchObject({
      name: 'KTOWN4U',
      priceKRW: '18000.0000',
      effectivePriceKRW: '18000.0000',
      priceAuthority: 'VARIANT',
      effectiveSku: null,
      saleWindowInheritedFromProduct: false,
      saleWindowEmpty: false,
      position: 1,
    });
    expect(prisma.actionLog.create.mock.calls[0][0].data).toMatchObject({
      actionType: 'PRODUCT_CREATE',
      metadataJson: { scope: 'product_variant_sellable_contract' },
      afterJson: {
        variants: [
          expect.objectContaining({ effectiveSku: 'V-MP', effectivePriceKRW: '17000.0000' }),
          expect.objectContaining({ effectiveSku: null, effectivePriceKRW: '18000.0000' }),
        ],
      },
    });

    await server.close();
  });

  it('rejects nested stock-like fields inside a variant payload', async () => {
    const actor = buildActor();
    const prisma = buildPrisma({ actor, artists: [buildStoredArtist()] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/products',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: validCreatePayload({
        variants: [{ name: 'MUSIC PLANET', priceKRW: 17000, stockOnHand: 5 }],
      }),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain('variants[0].stockOnHand is not allowed');
    expect(prisma.product.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('rejects a variant sale window where saleStartAt is after or equal to saleEndAt before writing', async () => {
    const actor = buildActor();
    const prisma = buildPrisma({ actor, artists: [buildStoredArtist()] });
    const server = buildTestServer(prisma);
    await server.ready();

    const afterResponse = await server.inject({
      method: 'POST',
      url: '/products',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: validCreatePayload({
        variants: [{
          name: 'MUSIC PLANET',
          priceKRW: 17000,
          saleStartAt: '2026-08-01T00:00:00.000Z',
          saleEndAt: '2026-07-01T00:00:00.000Z',
        }],
      }),
    });
    const equalResponse = await server.inject({
      method: 'POST',
      url: '/products',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: validCreatePayload({
        variants: [{
          name: 'MUSIC PLANET',
          priceKRW: 17000,
          saleStartAt: '2026-07-01T00:00:00.000Z',
          saleEndAt: '2026-07-01T00:00:00.000Z',
        }],
      }),
    });

    expect(afterResponse.statusCode).toBe(400);
    expect(afterResponse.json().error.message).toContain('saleStartAt must be before saleEndAt');
    expect(equalResponse.statusCode).toBe(400);
    expect(equalResponse.json().error.message).toContain('saleStartAt must be before saleEndAt');
    expect(prisma.product.create).not.toHaveBeenCalled();
    expect(prisma.productVariant.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('rejects duplicate non-null variant SKUs within the same product before writing', async () => {
    const actor = buildActor();
    const prisma = buildPrisma({ actor, artists: [buildStoredArtist()] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/products',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: validCreatePayload({
        variants: [
          { name: 'MUSIC PLANET', priceKRW: 17000, sku: 'SKU-DUP' },
          { name: 'KTOWN4U', priceKRW: 18000, sku: ' SKU-DUP ' },
        ],
      }),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain('duplicate non-null SKU');
    expect(prisma.product.create).not.toHaveBeenCalled();
    expect(prisma.productVariant.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('rejects a negative variant price', async () => {
    const actor = buildActor();
    const prisma = buildPrisma({ actor, artists: [buildStoredArtist()] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/products',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: validCreatePayload({
        variants: [{ name: 'MUSIC PLANET', priceKRW: -1 }],
      }),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain('variants[0].priceKRW must be a non-negative decimal');

    await server.close();
  });

  it('returns variants on GET /products/:id ordered by position then id', async () => {
    const actor = buildActor();
    const prisma = buildPrisma({
      actor,
      products: [buildStoredProduct({ sku: 'PROD-SKU', barcode: 'PROD-BAR' })],
      productVariants: [
        buildStoredProductVariant({ id: 'variant_b', name: 'KTOWN4U', position: 1, priceKRW: '18000.0000' }),
        buildStoredProductVariant({ id: 'variant_a', name: 'MUSIC PLANET', position: 0, priceKRW: '17000.0000' }),
      ],
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: `/products/${PRODUCT_ID}`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.data.variants.map((v: { id: string }) => v.id)).toEqual(['variant_a', 'variant_b']);
    expect(body.data.variants[0]).toMatchObject({
      effectiveSku: 'PROD-SKU',
      effectiveBarcode: 'PROD-BAR',
      skuInherited: true,
      barcodeInherited: true,
      effectivePriceKRW: '17000.0000',
      priceAuthority: 'VARIANT',
    });

    await server.close();
  });

  it('projects legacy equal-bound variant sale windows as empty instead of throwing on read', async () => {
    const actor = buildActor();
    const equalBound = new Date('2026-07-01T00:00:00.000Z');
    const prisma = buildPrisma({
      actor,
      products: [buildStoredProduct()],
      productVariants: [
        buildStoredProductVariant({
          id: 'variant_equal_bound',
          saleStartAt: equalBound,
          saleEndAt: equalBound,
        }),
      ],
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: `/products/${PRODUCT_ID}`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.data.variants[0]).toMatchObject({
      id: 'variant_equal_bound',
      saleStartAt: equalBound.toISOString(),
      saleEndAt: equalBound.toISOString(),
      effectiveSaleStartAt: null,
      effectiveSaleEndAt: null,
      saleWindowInheritedFromProduct: false,
      saleWindowEmpty: true,
    });

    await server.close();
  });

  it('does not project variants on GET /products list', async () => {
    const actor = buildActor();
    const prisma = buildPrisma({
      actor,
      products: [buildStoredProduct()],
      productVariants: [buildStoredProductVariant()],
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/products',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.data.items[0]).not.toHaveProperty('variants');
    expect(prisma.productVariant.findMany).not.toHaveBeenCalled();

    await server.close();
  });

  it('reconciles variants on PATCH: create new, update matched, delete missing', async () => {
    const actor = buildActor();
    const product = buildStoredProduct();
    const prisma = buildPrisma({
      actor,
      products: [product],
      updatedProduct: product,
      productVariants: [
        buildStoredProductVariant({ id: 'variant_keep', name: 'OLD NAME', position: 0 }),
        buildStoredProductVariant({ id: 'variant_drop', name: 'DROP ME', position: 1 }),
      ],
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'PATCH',
      url: `/products/${PRODUCT_ID}`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: {
        variants: [
          { id: 'variant_keep', name: 'NEW NAME', priceKRW: 19000 },
          { name: 'BRAND NEW', priceKRW: 20000 },
        ],
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.productVariant.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['variant_drop'] }, productId: PRODUCT_ID },
    });
    expect(prisma.productVariant.update).toHaveBeenCalledTimes(1);
    expect(prisma.productVariant.create).toHaveBeenCalledTimes(1);
    const names = body.data.variants.map((v: { name: string }) => v.name).sort();
    expect(names).toEqual(['BRAND NEW', 'NEW NAME']);

    await server.close();
  });

  it('PATCH with empty variants array deletes all variants for the product', async () => {
    const actor = buildActor();
    const product = buildStoredProduct();
    const prisma = buildPrisma({
      actor,
      products: [product],
      updatedProduct: product,
      productVariants: [
        buildStoredProductVariant({ id: 'variant_1', position: 0 }),
        buildStoredProductVariant({ id: 'variant_2', position: 1 }),
      ],
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'PATCH',
      url: `/products/${PRODUCT_ID}`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { variants: [] },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(prisma.productVariant.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['variant_1', 'variant_2'] }, productId: PRODUCT_ID },
    });
    expect(body.data.variants).toEqual([]);

    await server.close();
  });

  it('PATCH without variants leaves variants untouched', async () => {
    const actor = buildActor();
    const product = buildStoredProduct();
    const prisma = buildPrisma({
      actor,
      products: [product],
      updatedProduct: buildStoredProduct({ name: 'Renamed' }),
      productVariants: [buildStoredProductVariant({ id: 'variant_1' })],
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'PATCH',
      url: `/products/${PRODUCT_ID}`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { name: 'Renamed' },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(prisma.productVariant.findMany).not.toHaveBeenCalled();
    expect(prisma.productVariant.deleteMany).not.toHaveBeenCalled();
    expect(prisma.productVariant.create).not.toHaveBeenCalled();
    expect(body.data).not.toHaveProperty('variants');

    await server.close();
  });

  it('PATCH referencing a variant id from another product is rejected', async () => {
    const actor = buildActor();
    const product = buildStoredProduct();
    const prisma = buildPrisma({
      actor,
      products: [product],
      updatedProduct: product,
      productVariants: [buildStoredProductVariant({ id: 'variant_1' })],
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'PATCH',
      url: `/products/${PRODUCT_ID}`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { variants: [{ id: 'variant_other', name: 'X', priceKRW: 1000 }] },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('PRODUCT_VARIANT_NOT_FOUND');

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
  id: string; name: string; artistId: string | null; category: ProductCategory | null; categoryMinor: 'BOY_GROUP' | 'GIRL_GROUP' | 'SOLO' | 'JAPANESE_ALBUM' | 'OST' | 'OFFICIAL_GOODS' | 'FANDOM_GOODS' | null; itemType: 'LIGHT_STICK' | 'MD' | 'PHOTOBOOK' | 'PHOTO_CARD' | 'MUSIC_SHEET' | 'SANRIO' | 'HOLDER' | 'COLLECT_BOOK' | 'STICKER' | null; weightG: number | null;
  labelName: string | null; releaseDateText: string | null; releaseDate: Date | null; sku: string | null; barcode: string | null;
  stockOnHand: number; orderBasedStock: number; shipmentBasedStock: number;
  stockManaged: boolean; saleStatus: ProductSaleStatus;
  isDisplayed: boolean; categoryMappingSource: CategoryMappingSource; sourceCategoryCodes: string[];
  categoryReviewStatus: CategoryReviewStatus; thumbnailUrl: string | null; detailHtml: string | null;
  publicSaleStartsAt: Date | null; publicSaleEndsAt: Date | null;
  publicSaleWindowStatus: ProductPublicSaleWindowStatus;
  publicSaleWindowUpdatedByUserId: string | null; publicSaleWindowUpdatedAt: Date | null;
}> = {}) {
  return {
    id: overrides.id ?? PRODUCT_ID,
    artistId: overrides.artistId === undefined ? ARTIST_ID : overrides.artistId,
    category: overrides.category === undefined ? 'ALBUM' as ProductCategory : overrides.category,
    categoryMinor: overrides.categoryMinor === undefined ? null : overrides.categoryMinor,
    itemType: overrides.itemType === undefined ? null : overrides.itemType,
    name: overrides.name ?? 'Standard Album',
    labelName: overrides.labelName === undefined ? null : overrides.labelName,
    thumbnailUrl: overrides.thumbnailUrl === undefined ? null : overrides.thumbnailUrl,
    detailHtml: overrides.detailHtml === undefined ? null : overrides.detailHtml,
    releaseDateText: overrides.releaseDateText === undefined ? null : overrides.releaseDateText,
    releaseDate: overrides.releaseDate === undefined ? null : overrides.releaseDate,
    weightG: overrides.weightG === undefined ? 150 : overrides.weightG,
    priceKRW: '15000.0000',
    priceStatus: 'CONFIRMED' as const,
    lastConfirmedPriceKRW: '15000.0000',
    lastConfirmedPriceAt: new Date('2026-05-27T00:00:00Z'),
    sourcePriceRaw: '15000',
    sku: overrides.sku === undefined ? null : overrides.sku,
    barcode: overrides.barcode === undefined ? null : overrides.barcode,
    avgPurchasePriceKRW: 12000,
    stockManaged: overrides.stockManaged ?? true,
    stockOnHand: overrides.stockOnHand ?? 0,
    orderBasedStock: overrides.orderBasedStock ?? 0,
    shipmentBasedStock: overrides.shipmentBasedStock ?? 0,
    saleStatus: overrides.saleStatus ?? ('DRAFT' as ProductSaleStatus),
    isDisplayed: overrides.isDisplayed ?? false,
    categoryMappingSource: overrides.categoryMappingSource ?? ('EXACT' as CategoryMappingSource),
    sourceCategoryCodes: overrides.sourceCategoryCodes ?? [],
    categoryReviewStatus: overrides.categoryReviewStatus ?? ('PENDING' as CategoryReviewStatus),
    publicSaleStartsAt: overrides.publicSaleStartsAt === undefined ? null : overrides.publicSaleStartsAt,
    publicSaleEndsAt: overrides.publicSaleEndsAt === undefined ? null : overrides.publicSaleEndsAt,
    publicSaleWindowStatus: overrides.publicSaleWindowStatus ?? ('DRAFT' as ProductPublicSaleWindowStatus),
    publicSaleWindowUpdatedByUserId: overrides.publicSaleWindowUpdatedByUserId === undefined ? null : overrides.publicSaleWindowUpdatedByUserId,
    publicSaleWindowUpdatedAt: overrides.publicSaleWindowUpdatedAt === undefined ? null : overrides.publicSaleWindowUpdatedAt,
    createdAt: new Date('2026-05-27T00:00:00Z'),
    updatedAt: new Date('2026-05-27T00:00:00Z'),
  };
}

function buildStoredMovement(overrides: Partial<{
  id: string; productId: string; type: StockMovementType; quantity: number; previousQty: number | null; newQty: number | null;
}> = {}) {
  return {
    id: overrides.id ?? 'mov_1',
    productId: overrides.productId ?? PRODUCT_ID,
    type: (overrides.type ?? 'INBOUND') as StockMovementType,
    quantity: overrides.quantity ?? 100,
    previousQty: overrides.previousQty === undefined ? null : overrides.previousQty,
    newQty: overrides.newQty === undefined ? null : overrides.newQty,
    reason: null,
    createdById: 'admin_1',
    createdAt: new Date('2026-05-27T00:00:00Z'),
  };
}

function buildStoredExternalMapping(overrides: Partial<{
  id: string; productId: string; sourceSystem: string; externalProductId: string; externalUrl: string | null; status: string;
}> = {}) {
  return {
    id: overrides.id ?? 'mapping_1',
    productId: overrides.productId ?? PRODUCT_ID,
    sourceSystem: overrides.sourceSystem ?? 'IMWEB_KR',
    externalProductId: overrides.externalProductId ?? '6571',
    externalUrl: overrides.externalUrl === undefined ? null : overrides.externalUrl,
    status: overrides.status ?? 'ACTIVE',
    firstSeenAt: new Date('2026-05-27T00:00:00Z'),
    lastSyncedAt: new Date('2026-05-27T00:00:00Z'),
  };
}

function buildStoredProductOption(overrides: Partial<{
  id: string; productId: string; name: string; position: number; values: Array<{ id: string; optionId: string; value: string; position: number; priceDeltaKRW: number; stockSnapshot: number | null }>;
}> = {}) {
  const id = overrides.id ?? 'option_1';
  return {
    id,
    productId: overrides.productId ?? PRODUCT_ID,
    name: overrides.name ?? 'VERSION',
    position: overrides.position ?? 0,
    values: overrides.values ?? [
      { id: 'option_value_1', optionId: id, value: 'MUSIC PLANET', position: 0, priceDeltaKRW: 0, stockSnapshot: null },
      { id: 'option_value_2', optionId: id, value: 'KTOWN4U', position: 1, priceDeltaKRW: 0, stockSnapshot: null },
    ],
  };
}

function buildStoredProductVariant(overrides: Partial<{
  id: string; productId: string; name: string; optionValueIds: string[]; sku: string | null; barcode: string | null;
  priceKRW: string; saleStartAt: Date | null; saleEndAt: Date | null; position: number;
}> = {}) {
  return {
    id: overrides.id ?? 'variant_1',
    productId: overrides.productId ?? PRODUCT_ID,
    name: overrides.name ?? 'MUSIC PLANET',
    optionValueIds: overrides.optionValueIds ?? [],
    sku: overrides.sku === undefined ? null : overrides.sku,
    barcode: overrides.barcode === undefined ? null : overrides.barcode,
    priceKRW: overrides.priceKRW ?? '15000.0000',
    saleStartAt: overrides.saleStartAt === undefined ? null : overrides.saleStartAt,
    saleEndAt: overrides.saleEndAt === undefined ? null : overrides.saleEndAt,
    position: overrides.position ?? 0,
    createdAt: new Date('2026-06-23T00:00:00Z'),
    updatedAt: new Date('2026-06-23T00:00:00Z'),
  };
}

interface PrismaInput {
  actor: ReturnType<typeof buildActor>;
  artists?: ReturnType<typeof buildStoredArtist>[];
  products?: ReturnType<typeof buildStoredProduct>[];
  movements?: ReturnType<typeof buildStoredMovement>[];
  externalMappings?: ReturnType<typeof buildStoredExternalMapping>[];
  productOptions?: ReturnType<typeof buildStoredProductOption>[];
  productVariants?: ReturnType<typeof buildStoredProductVariant>[];
  createdProduct?: ReturnType<typeof buildStoredProduct>;
  updatedProduct?: ReturnType<typeof buildStoredProduct>;
  createdMovement?: ReturnType<typeof buildStoredMovement>;
  nextProductSeq?: number;
  orderItems?: Array<{
    productId: string;
    quantity: number;
    shipmentStatus: ShipmentItemStatus;
    orderStatus: OrderStatus;
  }>;
}

function buildPrisma(input: PrismaInput) {
  const artists = input.artists ?? [];
  const products = input.products ?? [];
  const movements = input.movements ?? [];
  const externalMappings = input.externalMappings ?? [];
  const productOptions = input.productOptions ?? [];
  const productVariants = [...(input.productVariants ?? [])];
  let variantSeq = productVariants.length;
  const orderItems = input.orderItems ?? [];

  const prisma = {
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
      update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const base = input.updatedProduct ?? products.find((p) => p.id === args.where.id) ?? products[0];
        const stockIncrement = (args.data.stockOnHand as { increment?: number } | undefined)?.increment;
        const shipmentIncrement = (args.data.shipmentBasedStock as { increment?: number } | undefined)?.increment;
        if (typeof stockIncrement === 'number' || typeof shipmentIncrement === 'number') {
          return {
            ...base,
            stockOnHand: base.stockOnHand + (stockIncrement ?? 0),
            shipmentBasedStock: base.shipmentBasedStock + (shipmentIncrement ?? 0),
          };
        }
        return { ...base, ...args.data };
      }),
    },
    productSequence: {
      upsert: vi.fn(async () => ({ key: 'KODY-PROD', lastSeq: input.nextProductSeq ?? 1 })),
    },
    productExternalMapping: {
      findUnique: vi.fn(async () => null),
      findMany: vi.fn(async (args: { where?: { productId?: string; sourceSystem?: string } }) => {
        if (args.where?.productId) {
          return externalMappings.filter((mapping) => mapping.productId === args.where?.productId);
        }
        if (args.where?.sourceSystem) {
          return externalMappings.filter((mapping) => mapping.sourceSystem === args.where?.sourceSystem);
        }
        return externalMappings;
      }),
      create: vi.fn(async () => { throw new Error('not used'); }),
      update: vi.fn(async () => { throw new Error('not used'); }),
    },
    productOption: {
      deleteMany: vi.fn(async () => ({})),
      create: vi.fn(async () => ({})),
      findMany: vi.fn(async (args: { where: { productId: string } }) => productOptions.filter((option) => option.productId === args.where.productId)),
    },
    productVariant: {
      findMany: vi.fn(async (args: { where: { productId: string } }) =>
        productVariants
          .filter((variant) => variant.productId === args.where.productId)
          .sort((a, b) => (a.position !== b.position ? a.position - b.position : a.id < b.id ? -1 : 1)),
      ),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        variantSeq += 1;
        const data = args.data;
        const created = {
          id: (data.id as string | undefined) ?? `variant_new_${variantSeq}`,
          productId: data.productId as string,
          name: data.name as string,
          optionValueIds: (data.optionValueIds as string[] | undefined) ?? [],
          sku: (data.sku as string | null | undefined) ?? null,
          barcode: (data.barcode as string | null | undefined) ?? null,
          priceKRW: data.priceKRW as string,
          saleStartAt: (data.saleStartAt as Date | null | undefined) ?? null,
          saleEndAt: (data.saleEndAt as Date | null | undefined) ?? null,
          position: (data.position as number | undefined) ?? 0,
          createdAt: new Date('2026-06-23T00:00:00Z'),
          updatedAt: new Date('2026-06-23T00:00:00Z'),
        };
        productVariants.push(created);
        return created;
      }),
      update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const existing = productVariants.find((variant) => variant.id === args.where.id);
        if (!existing) throw new Error(`variant ${args.where.id} not found`);
        Object.assign(existing, args.data);
        return existing;
      }),
      deleteMany: vi.fn(async (args: { where: { id: { in: string[] }; productId: string } }) => {
        const ids = new Set(args.where.id.in);
        for (let i = productVariants.length - 1; i >= 0; i -= 1) {
          if (ids.has(productVariants[i].id) && productVariants[i].productId === args.where.productId) {
            productVariants.splice(i, 1);
          }
        }
        return {};
      }),
    },
    stockMovement: {
      create: vi.fn(async () => {
        if (!input.createdMovement) throw new Error('createdMovement not provided');
        return input.createdMovement;
      }),
      findMany: vi.fn(async () => movements),
    },
    orderItem: {
      groupBy: vi.fn(async (args: {
        by: ['productId'];
        where: {
          productId: { in: string[] };
          order: { status: OrderStatus };
          shipmentStatus: { not: ShipmentItemStatus };
        };
        _sum: { quantity: true };
      }) => {
        const ids = args.where.productId.in;
        const wantedOrderStatus = args.where.order.status;
        const excludedShipmentStatus = args.where.shipmentStatus.not;
        const totals = new Map<string, number>();
        for (const item of orderItems) {
          if (!ids.includes(item.productId)) continue;
          if (item.orderStatus !== wantedOrderStatus) continue;
          if (item.shipmentStatus === excludedShipmentStatus) continue;
          totals.set(item.productId, (totals.get(item.productId) ?? 0) + item.quantity);
        }
        return [...totals.entries()].map(([productId, quantity]) => ({
          productId,
          _sum: { quantity },
        }));
      }),
    },
    refreshToken: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
    },
    actionLog: { create: vi.fn(async () => ({})) },
  };

  return {
    ...prisma,
    $transaction: vi.fn(async (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma)),
  };
}
