import { describe, expect, it, vi } from 'vitest';
import { issueAccessToken } from '@/domain/auth/tokens.js';
import type { Incoterm, Role, ShipmentStatus, UserStatus } from '@/domain/shared/types.js';
import { buildTestServer as _buildTestServer } from './helpers.js';
import type { PrismaClient } from '@prisma/client';

function buildTestServer(prisma: unknown) {
  return _buildTestServer(prisma as Partial<PrismaClient>);
}

const SHIPMENT_ID = 'SHIP-240315-01';
const ORDER_ID = '2403150010000';
const ORDER_ITEM_ID = '2403150010001';
const PRODUCT_ID = 'P-ATEZ-001';

function issueToken(userId: string, roles: Role[]) {
  return issueAccessToken({ sub: userId, email: `${userId}@kody.test`, roles }, 'test-secret').token;
}

describe('shipment routes', () => {
  it('allocates a shipment once, deducts stock, links OUTBOUND movement to ShipmentItem, and logs an event', async () => {
    const actor = buildActor({ roles: ['WAREHOUSE'] });
    const prisma = buildPrisma({ actor, stockOnHand: 5 });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: `/shipments/${SHIPMENT_ID}/allocate`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.orderId).toBe(ORDER_ID);
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith('SELECT id FROM "Product" WHERE id = $1 FOR UPDATE', PRODUCT_ID);
    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: PRODUCT_ID },
      data: { stockOnHand: { decrement: 2 }, shipmentBasedStock: { decrement: 2 } },
    });
    expect(prisma.orderItem.update).toHaveBeenCalledWith({ where: { id: ORDER_ITEM_ID }, data: { shipmentStatus: 'PENDING' } });
    expect(prisma.stockMovement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        productId: PRODUCT_ID,
        shipmentItemId: 'ship_item_1',
        type: 'OUTBOUND',
        quantity: -2,
        previousQty: 5,
        newQty: 3,
      }),
    });
    expect(prisma.shipmentEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ shipmentId: SHIPMENT_ID, eventType: 'ALLOCATED', actorUserId: actor.id }),
    });
    expect(prisma.actionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ actionType: 'SHIPMENT_PICK', targetType: 'Shipment', targetId: SHIPMENT_ID }),
    });
    await server.close();
  });

  it('is idempotent for an already allocated shipment and does not deduct stock twice', async () => {
    const actor = buildActor({ roles: ['WAREHOUSE'] });
    const prisma = buildPrisma({ actor, stockOnHand: 5, itemShipmentStatus: 'PENDING', orderId: ORDER_ID });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: `/shipments/${SHIPMENT_ID}/allocate`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });

    expect(response.statusCode).toBe(200);
    expect(prisma.product.update).not.toHaveBeenCalled();
    expect(prisma.stockMovement.create).not.toHaveBeenCalled();
    expect(prisma.shipmentEvent.create).not.toHaveBeenCalled();
    expect(prisma.actionLog.create).not.toHaveBeenCalled();
    await server.close();
  });

  it('rejects allocation when stock is insufficient and leaves shipment items untouched', async () => {
    const actor = buildActor({ roles: ['WAREHOUSE'] });
    const prisma = buildPrisma({ actor, stockOnHand: 1 });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: `/shipments/${SHIPMENT_ID}/allocate`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('INSUFFICIENT_STOCK');
    expect(prisma.product.update).not.toHaveBeenCalled();
    expect(prisma.orderItem.update).not.toHaveBeenCalled();
    expect(prisma.stockMovement.create).not.toHaveBeenCalled();
    await server.close();
  });
});

function decimal(value: string) {
  return { toString: () => value };
}

function buildActor(overrides: Partial<{ id: string; email: string; roles: Role[]; status: UserStatus }> = {}) {
  return {
    id: 'user_1',
    email: 'actor@example.com',
    roles: ['WAREHOUSE'] as Role[],
    status: 'ACTIVE' as UserStatus,
    ...overrides,
  };
}

function buildShipment(options: { orderId?: string | null; itemShipmentStatus?: 'NOT_SHIPPED' | 'PENDING' | 'COMPLETED' } = {}) {
  return {
    id: SHIPMENT_ID,
    orderId: options.orderId ?? null,
    accountId: 'acc_1',
    shippingAddressId: 'addr_1',
    shipDate: null,
    incoterm: 'FOB' as Incoterm,
    undervalueFile: null,
    trackingNumber: null,
    status: 'PENDING' as ShipmentStatus,
    createdAt: new Date('2024-03-15T00:00:00.000Z'),
    updatedAt: new Date('2024-03-15T00:00:00.000Z'),
    items: [
      {
        id: 'ship_item_1',
        shipmentId: SHIPMENT_ID,
        orderItemId: ORDER_ITEM_ID,
        productId: PRODUCT_ID,
        quantity: 2,
        hsCode: null,
        htsCode: null,
        subtotal: decimal('180.00'),
        createdAt: new Date('2024-03-15T00:00:00.000Z'),
        orderItem: { id: ORDER_ITEM_ID, orderId: ORDER_ID, shipmentStatus: options.itemShipmentStatus ?? 'NOT_SHIPPED' },
        stockMovements: [] as Array<{ id: string }>,
      },
    ],
  };
}

function buildPrisma(options: {
  actor: ReturnType<typeof buildActor>;
  stockOnHand: number;
  orderId?: string | null;
  itemShipmentStatus?: 'NOT_SHIPPED' | 'PENDING' | 'COMPLETED';
}) {
  const actor = options.actor;
  const shipment = buildShipment({ orderId: options.orderId, itemShipmentStatus: options.itemShipmentStatus });
  const prisma = {
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(prisma)),
    $executeRawUnsafe: vi.fn(async () => 1),
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; email?: string } }) =>
        where.id === actor.id || where.email === actor.email
          ? {
              ...actor,
              loginId: actor.email,
              employeeId: 'emp_1',
              displayName: 'Actor',
              profileImageUrl: null,
              passwordHash: 'unused',
              failedLoginCount: 0,
              lockedUntil: null,
              lastLoginAt: null,
              createdAt: new Date('2024-03-15T00:00:00.000Z'),
              updatedAt: new Date('2024-03-15T00:00:00.000Z'),
              roles: actor.roles.map((role) => ({ role })),
            }
          : null,
      ),
    },
    shipment: {
      findUnique: vi.fn(async () => shipment),
      update: vi.fn(async ({ data }: { data: { orderId?: string } }) => {
        Object.assign(shipment, data, { updatedAt: new Date('2024-03-15T01:00:00.000Z') });
        return shipment;
      }),
    },
    product: {
      findUnique: vi.fn(async () => ({ id: PRODUCT_ID, stockOnHand: options.stockOnHand, shipmentBasedStock: options.stockOnHand })),
      update: vi.fn(async () => ({ id: PRODUCT_ID, stockOnHand: options.stockOnHand - 2, shipmentBasedStock: options.stockOnHand - 2 })),
    },
    orderItem: {
      update: vi.fn(async ({ data }: { data: { shipmentStatus: 'PENDING' } }) => {
        shipment.items[0].orderItem.shipmentStatus = data.shipmentStatus;
        return shipment.items[0].orderItem;
      }),
    },
    stockMovement: {
      create: vi.fn(async () => {
        const movement = { id: 'move_1' };
        shipment.items[0].stockMovements = [movement];
        return movement;
      }),
    },
    shipmentEvent: {
      create: vi.fn(async () => ({})),
    },
    actionLog: {
      create: vi.fn(async () => ({})),
    },
  };
  return prisma;
}
