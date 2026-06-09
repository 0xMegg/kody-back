import { describe, expect, it, vi } from 'vitest';
import { issueAccessToken } from '@/domain/auth/tokens.js';
import type { Currency, OrderStatus, Role, UserStatus } from '@/domain/shared/types.js';
import { buildTestServer as _buildTestServer } from './helpers.js';
import type { PrismaClient } from '@prisma/client';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildTestServer(prisma: any) {
  return _buildTestServer(prisma as Partial<PrismaClient>);
}

const ACCOUNT_ID = 'acc_1';
const PRODUCT_ID = 'P-ATEZ-001';
const ORDER_ID = '2403150010000';
const ITEM_ID = '2403150010001';

function issueToken(userId: string, roles: Role[]) {
  return issueAccessToken({ sub: userId, email: `${userId}@kody.test`, roles }, 'test-secret').token;
}

describe('order routes', () => {
  it('rejects unauthenticated POST /orders as AUTHENTICATION_ERROR', async () => {
    const prisma = buildPrisma({ actor: buildActor() });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({ method: 'POST', url: '/orders', payload: validCreatePayload() });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('AUTHENTICATION_ERROR');
    await server.close();
  });

  it('rejects WAREHOUSE from POST /orders as AUTHORIZATION_ERROR', async () => {
    const actor = buildActor({ roles: ['WAREHOUSE'] });
    const prisma = buildPrisma({ actor });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: validCreatePayload(),
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('AUTHORIZATION_ERROR');
    await server.close();
  });

  it('allows SALES to create a PENDING order with generated order/item ids and subtotals', async () => {
    const actor = buildActor({ roles: ['SALES'] });
    const prisma = buildPrisma({ actor, accounts: [{ id: ACCOUNT_ID }], products: [{ id: PRODUCT_ID }] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: validCreatePayload(),
    });
    const body = response.json();

    expect(response.statusCode).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.data.id).toBe(ORDER_ID);
    expect(body.data.status).toBe('PENDING');
    expect(body.data.items[0].id).toBe(ITEM_ID);
    expect(body.data.items[0].shipmentStatus).toBe('NOT_SHIPPED');
    expect(body.data.items[0].subtotal).toBe('180.00');
    expect(prisma.orderSequence.upsert).toHaveBeenCalledWith({
      where: { date: '240315' },
      create: { date: '240315', lastSeq: 1 },
      update: { lastSeq: { increment: 1 } },
    });
    expect(prisma.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id: ORDER_ID,
          status: 'PENDING',
          items: { create: [expect.objectContaining({ id: ITEM_ID, subtotal: '180.00' })] },
        }),
      }),
    );
    expect(prisma.actionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ actionType: 'ORDER_CREATE', targetType: 'Order', targetId: ORDER_ID }),
    });
    await server.close();
  });

  it('lists orders for WAREHOUSE read permission', async () => {
    const actor = buildActor({ roles: ['WAREHOUSE'] });
    const prisma = buildPrisma({ actor, orders: [buildStoredOrder()] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/orders?limit=1',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.items).toHaveLength(1);
    await server.close();
  });

  it('returns order detail on GET /orders/:id', async () => {
    const actor = buildActor();
    const prisma = buildPrisma({ actor, orders: [buildStoredOrder()] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: `/orders/${ORDER_ID}`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.id).toBe(ORDER_ID);
    await server.close();
  });

  it('confirms a PENDING order, increments orderBasedStock transactionally, and logs ORDER_CONFIRM', async () => {
    const actor = buildActor({ roles: ['OPERATIONS'] });
    const prisma = buildPrisma({ actor, orders: [buildStoredOrder({ status: 'PENDING' })] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: `/orders/${ORDER_ID}/confirm`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.status).toBe('CONFIRMED');
    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: PRODUCT_ID },
      data: { orderBasedStock: { increment: 2 } },
    });
    expect(prisma.actionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ actionType: 'ORDER_CONFIRM', targetId: ORDER_ID }),
    });
    await server.close();
  });

  it('rejects confirming a CONFIRMED order', async () => {
    const actor = buildActor({ roles: ['OPERATIONS'] });
    const prisma = buildPrisma({ actor, orders: [buildStoredOrder({ status: 'CONFIRMED' })] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: `/orders/${ORDER_ID}/confirm`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('ORDER_STATUS_INVALID');
    await server.close();
  });

  it('suspends a CONFIRMED order, decrements orderBasedStock transactionally, and logs ORDER_CANCEL', async () => {
    const actor = buildActor({ roles: ['SALES'] });
    const prisma = buildPrisma({ actor, orders: [buildStoredOrder({ status: 'CONFIRMED' })] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: `/orders/${ORDER_ID}/suspend`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.status).toBe('SUSPENDED');
    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: PRODUCT_ID },
      data: { orderBasedStock: { decrement: 2 } },
    });
    expect(prisma.actionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ actionType: 'ORDER_CANCEL', targetId: ORDER_ID }),
    });
    await server.close();
  });

  it('suspends a PENDING order without stock change', async () => {
    const actor = buildActor({ roles: ['SALES'] });
    const prisma = buildPrisma({ actor, orders: [buildStoredOrder({ status: 'PENDING' })] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: `/orders/${ORDER_ID}/suspend`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.status).toBe('SUSPENDED');
    expect(prisma.product.update).not.toHaveBeenCalled();
    await server.close();
  });

  it('uses conditional status updates before stock mutation for confirm and suspend', async () => {
    const actor = buildActor({ roles: ['OPERATIONS'] });
    const confirmPrisma = buildPrisma({ actor, orders: [buildStoredOrder({ status: 'PENDING' })] });
    const confirmServer = buildTestServer(confirmPrisma);
    await confirmServer.ready();

    const confirmed = await confirmServer.inject({
      method: 'POST',
      url: `/orders/${ORDER_ID}/confirm`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });

    expect(confirmed.statusCode).toBe(200);
    expect(confirmPrisma.order.updateMany).toHaveBeenCalledWith({
      where: { id: ORDER_ID, status: 'PENDING' },
      data: { status: 'CONFIRMED' },
    });
    expect(confirmPrisma.product.update).toHaveBeenCalledTimes(1);
    const repeatedConfirm = await confirmServer.inject({
      method: 'POST',
      url: `/orders/${ORDER_ID}/confirm`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });
    expect(repeatedConfirm.statusCode).toBe(400);
    expect(repeatedConfirm.json().error.code).toBe('ORDER_STATUS_INVALID');
    expect(confirmPrisma.product.update).toHaveBeenCalledTimes(1);
    await confirmServer.close();

    const suspendPrisma = buildPrisma({ actor, orders: [buildStoredOrder({ status: 'CONFIRMED' })] });
    const suspendServer = buildTestServer(suspendPrisma);
    await suspendServer.ready();

    const suspended = await suspendServer.inject({
      method: 'POST',
      url: `/orders/${ORDER_ID}/suspend`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });

    expect(suspended.statusCode).toBe(200);
    expect(suspendPrisma.order.updateMany).toHaveBeenCalledWith({
      where: { id: ORDER_ID, status: 'CONFIRMED' },
      data: { status: 'SUSPENDED' },
    });
    expect(suspendPrisma.product.update).toHaveBeenCalledTimes(1);
    const repeatedSuspend = await suspendServer.inject({
      method: 'POST',
      url: `/orders/${ORDER_ID}/suspend`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });
    expect(repeatedSuspend.statusCode).toBe(400);
    expect(repeatedSuspend.json().error.code).toBe('ORDER_STATUS_INVALID');
    expect(suspendPrisma.product.update).toHaveBeenCalledTimes(1);
    await suspendServer.close();
  });

  it('rejects negative prices and fees while allowing zero values', async () => {
    const actor = buildActor({ roles: ['SALES'] });
    const prisma = buildPrisma({ actor, accounts: [{ id: ACCOUNT_ID }], products: [{ id: PRODUCT_ID }] });
    const server = buildTestServer(prisma);
    await server.ready();

    for (const payload of [
      { ...validCreatePayload(), items: [{ productId: PRODUCT_ID, unitPrice: '-1.00', quantity: 1 }] },
      { ...validCreatePayload(), shippingFee: '-0.01' },
      { ...validCreatePayload(), remittanceFee: '-0.01' },
    ]) {
      const response = await server.inject({
        method: 'POST',
        url: '/orders',
        headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
        payload,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_ERROR');
    }

    const zeroResponse = await server.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { ...validCreatePayload(), shippingFee: '0', remittanceFee: '0', items: [{ productId: PRODUCT_ID, unitPrice: '0', quantity: 1 }] },
    });
    expect(zeroResponse.statusCode).toBe(201);
    await server.close();
  });

  it('rejects order creation when the daily sequence exceeds 999', async () => {
    const actor = buildActor({ roles: ['SALES'] });
    const prisma = buildPrisma({ actor, accounts: [{ id: ACCOUNT_ID }], products: [{ id: PRODUCT_ID }] });
    prisma.orderSequence.upsert.mockResolvedValueOnce({ id: 1, date: '240315', lastSeq: 1000 });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: validCreatePayload(),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('ORDER_SEQUENCE_LIMIT_EXCEEDED');
    expect(prisma.order.create).not.toHaveBeenCalled();
    await server.close();
  });
});

function validCreatePayload() {
  return {
    orderDate: '2024-03-15T00:00:00.000Z',
    accountId: ACCOUNT_ID,
    salesRepId: 'user_1',
    currency: 'USD' as Currency,
    shippingFee: '5.00',
    remittanceFee: '1.00',
    memo: 'first order',
    items: [{ productId: PRODUCT_ID, unitPrice: '100.00', quantity: 2, discountRate: '0.10' }],
  };
}

function decimal(value: string) {
  return { toString: () => value };
}

function buildStoredOrder(overrides: Partial<StoredOrder> = {}): StoredOrder {
  const order: StoredOrder = {
    id: ORDER_ID,
    orderDate: new Date('2024-03-15T00:00:00.000Z'),
    accountId: ACCOUNT_ID,
    salesRepId: 'user_1',
    currency: 'USD',
    status: 'PENDING',
    shippingFee: decimal('5.00'),
    remittanceFee: decimal('1.00'),
    memo: 'first order',
    createdAt: new Date('2024-03-15T01:00:00.000Z'),
    updatedAt: new Date('2024-03-15T01:00:00.000Z'),
    items: [
      {
        id: ITEM_ID,
        orderId: ORDER_ID,
        productId: PRODUCT_ID,
        unitPrice: decimal('100.00'),
        quantity: 2,
        discountRate: decimal('0.10'),
        subtotal: decimal('180.00'),
        shipmentStatus: 'NOT_SHIPPED',
        createdAt: new Date('2024-03-15T01:00:00.000Z'),
        updatedAt: new Date('2024-03-15T01:00:00.000Z'),
      },
    ],
  };

  return { ...order, ...overrides };
}

interface StoredOrder {
  id: string;
  orderDate: Date;
  accountId: string;
  salesRepId: string;
  currency: Currency;
  status: OrderStatus;
  shippingFee: { toString(): string };
  remittanceFee: { toString(): string };
  memo: string | null;
  createdAt: Date;
  updatedAt: Date;
  items: Array<{
    id: string;
    orderId: string;
    productId: string;
    unitPrice: { toString(): string };
    quantity: number;
    discountRate: { toString(): string };
    subtotal: { toString(): string };
    shipmentStatus: 'NOT_SHIPPED' | 'PENDING' | 'COMPLETED';
    createdAt: Date;
    updatedAt: Date;
  }>;
}

function buildActor(overrides: Partial<{ id: string; email: string; roles: Role[]; status: UserStatus }> = {}) {
  return {
    id: 'user_1',
    email: 'actor@example.com',
    roles: ['ADMIN'] as Role[],
    status: 'ACTIVE' as UserStatus,
    ...overrides,
  };
}

function buildPrisma(options: {
  actor: ReturnType<typeof buildActor>;
  accounts?: Array<{ id: string }>;
  products?: Array<{ id: string }>;
  orders?: StoredOrder[];
}) {
  const orders = [...(options.orders ?? [])];
  const createdOrder = buildStoredOrder();
  const actor = options.actor;
  const users = [actor];

  const prisma = {
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(prisma)),
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; email?: string } }) => {
        const user = users.find((candidate) => candidate.id === where.id || candidate.email === where.email);
        return user
          ? {
              ...user,
              loginId: user.email,
              employeeId: 'emp_1',
              displayName: 'Actor',
              profileImageUrl: null,
              passwordHash: 'unused',
              failedLoginCount: 0,
              lockedUntil: null,
              lastLoginAt: null,
              createdAt: new Date('2024-03-15T00:00:00.000Z'),
              updatedAt: new Date('2024-03-15T00:00:00.000Z'),
              roles: user.roles.map((role) => ({ role })),
            }
          : null;
      }),
    },
    account: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        (options.accounts ?? [{ id: ACCOUNT_ID }]).find((account) => account.id === where.id) ?? null,
      ),
    },
    product: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        (options.products ?? [{ id: PRODUCT_ID }]).find((product) => product.id === where.id) ?? null,
      ),
      update: vi.fn(async () => ({})),
    },
    orderSequence: {
      upsert: vi.fn(async () => ({ id: 1, date: '240315', lastSeq: 1 })),
    },
    order: {
      create: vi.fn(async () => createdOrder),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        orders.find((order) => order.id === where.id) ?? null,
      ),
      findMany: vi.fn(async () => orders),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<StoredOrder> }) => {
        const current = orders.find((order) => order.id === where.id) ?? buildStoredOrder();
        return { ...current, ...data, updatedAt: new Date('2024-03-15T02:00:00.000Z') };
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; status: OrderStatus }; data: Partial<StoredOrder> }) => {
        const current = orders.find((order) => order.id === where.id && order.status === where.status);
        if (!current) return { count: 0 };
        Object.assign(current, data, { updatedAt: new Date('2024-03-15T02:00:00.000Z') });
        return { count: 1 };
      }),
    },
    actionLog: {
      create: vi.fn(async () => ({})),
    },
  };

  return prisma;
}
