import { describe, expect, it, vi } from 'vitest';
import { issueAccessToken } from '@/domain/auth/tokens.js';
import type { ProductCategory, Role, StockMovementType, UserStatus } from '@/domain/shared/types.js';
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

  it('creates product and returns 201 with P-PREFIX-NNN id', async () => {
    const actor = buildActor();
    const product = buildStoredProduct();
    const prisma = buildPrisma({ actor, artists: [buildStoredArtist()], createdProduct: product });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/products',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: validCreatePayload(),
    });
    const body = response.json();

    expect(response.statusCode).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.data.id).toMatch(/^P-[A-Z]+-\d{3}$/);

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

function validCreatePayload() {
  return {
    artistId: ARTIST_ID,
    category: 'ALBUM' as ProductCategory,
    name: 'Standard Album',
    weightG: 150,
    priceKRW: 15000,
  };
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
  id: string; name: string; category: ProductCategory;
}> = {}) {
  return {
    id: overrides.id ?? PRODUCT_ID,
    artistId: ARTIST_ID,
    category: (overrides.category ?? 'ALBUM') as ProductCategory,
    name: overrides.name ?? 'Standard Album',
    weightG: 150,
    priceKRW: 15000,
    sku: null,
    barcode: null,
    avgPurchasePriceKRW: 12000,
    stockOnHand: 0,
    orderBasedStock: 0,
    shipmentBasedStock: 0,
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
