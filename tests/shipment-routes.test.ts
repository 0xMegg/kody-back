import { describe, expect, it, vi } from 'vitest';
import { ShipmentService } from '@/application/shipment/shipment-service.js';
import type { ActionLogWriter } from '@/application/shared/action-log-writer.js';
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
  it('allocates a shipment once without deducting stock before completion, and logs an event', async () => {
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
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
    expect(prisma.product.findUnique).not.toHaveBeenCalled();
    expect(prisma.product.update).not.toHaveBeenCalled();
    expect(prisma.orderItem.update).toHaveBeenCalledWith({ where: { id: ORDER_ITEM_ID }, data: { shipmentStatus: 'PENDING' } });
    expect(prisma.stockMovement.create).not.toHaveBeenCalled();
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

  it('packs a shipment and writes exactly one SHIPMENT_PACK action log with resulting packed state', async () => {
    const actor = buildActor({ roles: ['WAREHOUSE'] });
    const prisma = buildPrisma({ actor, stockOnHand: 5, itemShipmentStatus: 'PENDING', orderId: ORDER_ID });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: `/shipments/${SHIPMENT_ID}/pack`,
      headers: {
        authorization: `Bearer ${issueToken(actor.id, actor.roles)}`,
        'user-agent': 'shipment-test-agent',
      },
      remoteAddress: '203.0.113.10',
    });

    expect(response.statusCode).toBe(200);
    expect(prisma.shipmentEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ shipmentId: SHIPMENT_ID, eventType: 'PACKED', actorUserId: actor.id }),
    });
    expect(prisma.actionLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.actionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: actor.id,
        actionType: 'SHIPMENT_PACK',
        targetType: 'Shipment',
        targetId: SHIPMENT_ID,
        ipAddress: '203.0.113.10',
        userAgent: 'shipment-test-agent',
        afterJson: {
          shipmentId: SHIPMENT_ID,
          orderId: ORDER_ID,
          status: 'PENDING',
          itemCount: 1,
          itemShipmentStatuses: ['PENDING'],
        },
        metadataJson: expect.objectContaining({
          operation: 'PACKED',
          resultingState: 'PACKED',
          shipmentEventType: 'PACKED',
          requestId: expect.any(String),
        }),
      }),
    });
    await server.close();
  });

  it('completes a shipment and writes exactly one SHIPMENT_COMPLETE action log with before and after state', async () => {
    const actor = buildActor({ roles: ['WAREHOUSE'] });
    const prisma = buildPrisma({ actor, stockOnHand: 5, itemShipmentStatus: 'PENDING', orderId: ORDER_ID });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: `/shipments/${SHIPMENT_ID}/complete`,
      headers: {
        authorization: `Bearer ${issueToken(actor.id, actor.roles)}`,
        'user-agent': 'shipment-test-agent',
      },
      remoteAddress: '203.0.113.20',
    });

    expect(response.statusCode).toBe(200);
    expect(prisma.orderItem.update).toHaveBeenCalledWith({ where: { id: ORDER_ITEM_ID }, data: { shipmentStatus: 'COMPLETED' } });
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith('SELECT id FROM "Product" WHERE id = $1 FOR UPDATE', PRODUCT_ID);
    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: PRODUCT_ID },
      data: { stockOnHand: { decrement: 2 }, shipmentBasedStock: { decrement: 2 } },
    });
    expect(prisma.stockMovement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        productId: PRODUCT_ID,
        shipmentItemId: 'ship_item_1',
        type: 'OUTBOUND',
        quantity: -2,
        previousQty: 5,
        newQty: 3,
        reason: `Shipment completion ${SHIPMENT_ID}`,
        createdById: actor.id,
      }),
    });
    expect(prisma.shipment.update).toHaveBeenCalledWith({
      where: { id: SHIPMENT_ID },
      data: { status: 'COMPLETED' },
      include: { items: { include: { orderItem: true, stockMovements: true } } },
    });
    expect(prisma.shipmentEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ shipmentId: SHIPMENT_ID, eventType: 'COMPLETED', actorUserId: actor.id }),
    });
    expect(prisma.actionLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.actionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: actor.id,
        actionType: 'SHIPMENT_COMPLETE',
        targetType: 'Shipment',
        targetId: SHIPMENT_ID,
        ipAddress: '203.0.113.20',
        userAgent: 'shipment-test-agent',
        beforeJson: {
          shipmentId: SHIPMENT_ID,
          orderId: ORDER_ID,
          status: 'PENDING',
          itemCount: 1,
          itemShipmentStatuses: ['PENDING'],
        },
        afterJson: {
          shipmentId: SHIPMENT_ID,
          orderId: ORDER_ID,
          status: 'COMPLETED',
          itemCount: 1,
          itemShipmentStatuses: ['COMPLETED'],
        },
        metadataJson: expect.objectContaining({
          operation: 'COMPLETED',
          shipmentEventType: 'COMPLETED',
          transition: {
            shipmentStatus: { from: 'PENDING', to: 'COMPLETED' },
            itemShipmentStatuses: { from: ['PENDING'], to: ['COMPLETED'] },
          },
          requestId: expect.any(String),
        }),
      }),
    });
    await server.close();
  });

  it('does not deduct stock twice when completing an already completed shipment with an outbound movement', async () => {
    const actor = buildActor({ roles: ['WAREHOUSE'] });
    const prisma = buildPrisma({
      actor,
      stockOnHand: 3,
      itemShipmentStatus: 'COMPLETED',
      orderId: ORDER_ID,
      stockMovementId: 'move_existing',
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: `/shipments/${SHIPMENT_ID}/complete`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });

    expect(response.statusCode).toBe(200);
    expect(prisma.stockMovement.findFirst).not.toHaveBeenCalled();
    expect(prisma.product.update).not.toHaveBeenCalled();
    expect(prisma.stockMovement.create).not.toHaveBeenCalled();
    expect(prisma.orderItem.update).not.toHaveBeenCalled();
    await server.close();
  });

  it('rechecks outbound movement after product lock before deducting stock on shipment completion', async () => {
    const actor = buildActor({ roles: ['WAREHOUSE'] });
    const prisma = buildPrisma({
      actor,
      stockOnHand: 3,
      itemShipmentStatus: 'PENDING',
      orderId: ORDER_ID,
      concurrentOutboundMovementId: 'move_concurrent',
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: `/shipments/${SHIPMENT_ID}/complete`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });

    expect(response.statusCode).toBe(200);
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith('SELECT id FROM "Product" WHERE id = $1 FOR UPDATE', PRODUCT_ID);
    expect(prisma.stockMovement.findFirst).toHaveBeenCalledWith({
      where: { shipmentItemId: 'ship_item_1', type: 'OUTBOUND' },
      select: { id: true },
    });
    expect(prisma.product.findUnique).not.toHaveBeenCalled();
    expect(prisma.product.update).not.toHaveBeenCalled();
    expect(prisma.stockMovement.create).not.toHaveBeenCalled();
    expect(prisma.orderItem.update).toHaveBeenCalledWith({ where: { id: ORDER_ITEM_ID }, data: { shipmentStatus: 'COMPLETED' } });
    await server.close();
  });

  it('passes provided ipAddress and userAgent through the shipment complete service action log', async () => {
    const actor = buildActor({ roles: ['WAREHOUSE'] });
    const prisma = buildPrisma({ actor, stockOnHand: 5, itemShipmentStatus: 'PENDING', orderId: ORDER_ID });
    const actionLogWriter = { write: vi.fn(async () => undefined) };
    const service = new ShipmentService(prisma, actionLogWriter as unknown as ActionLogWriter);

    await service.completeShipment({
      actorUserId: actor.id,
      shipmentId: SHIPMENT_ID,
      ipAddress: '198.51.100.42',
      userAgent: 'shipment-service-test-agent',
    });

    expect(actionLogWriter.write).toHaveBeenCalledTimes(1);
    expect(actionLogWriter.write).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: actor.id,
        actionType: 'SHIPMENT_COMPLETE',
        targetType: 'Shipment',
        targetId: SHIPMENT_ID,
        ipAddress: '198.51.100.42',
        userAgent: 'shipment-service-test-agent',
        afterJson: {
          shipmentId: SHIPMENT_ID,
          orderId: ORDER_ID,
          status: 'COMPLETED',
          itemCount: 1,
          itemShipmentStatuses: ['COMPLETED'],
        },
      }),
    );
  });

  it('does not write action logs for failed or unauthorized shipment pack and complete attempts', async () => {
    const actor = buildActor({ roles: ['OPERATIONS'] });
    const prisma = buildPrisma({ actor, stockOnHand: 5, itemShipmentStatus: 'PENDING', orderId: ORDER_ID });
    const server = buildTestServer(prisma);
    await server.ready();

    const unauthorizedPack = await server.inject({
      method: 'POST',
      url: `/shipments/${SHIPMENT_ID}/pack`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });
    const unauthorizedComplete = await server.inject({
      method: 'POST',
      url: `/shipments/${SHIPMENT_ID}/complete`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });

    expect(unauthorizedPack.statusCode).toBe(403);
    expect(unauthorizedComplete.statusCode).toBe(403);
    expect(prisma.shipmentEvent.create).not.toHaveBeenCalled();
    expect(prisma.actionLog.create).not.toHaveBeenCalled();
    await server.close();
  });

  it('rejects shipment pack for a missing shipment without writing an action log', async () => {
    const actor = buildActor({ roles: ['WAREHOUSE'] });
    const prisma = buildPrisma({ actor, stockOnHand: 5, missingShipment: true });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: `/shipments/${SHIPMENT_ID}/pack`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('SHIPMENT_NOT_FOUND');
    expect(prisma.shipmentEvent.create).not.toHaveBeenCalled();
    expect(prisma.actionLog.create).not.toHaveBeenCalled();
    await server.close();
  });

  it('rejects shipment pack for a shipment with unallocated items without writing a SHIPMENT_PACK action log', async () => {
    const actor = buildActor({ roles: ['WAREHOUSE'] });
    const prisma = buildPrisma({ actor, stockOnHand: 5, itemShipmentStatus: 'NOT_SHIPPED', orderId: ORDER_ID });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: `/shipments/${SHIPMENT_ID}/pack`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('SHIPMENT_NOT_PACKED');
    expect(prisma.shipmentEvent.create).not.toHaveBeenCalled();
    expect(prisma.actionLog.create).not.toHaveBeenCalled();
    await server.close();
  });

  it('rejects shipment complete for a missing shipment without writing a SHIPMENT_COMPLETE action log', async () => {
    const actor = buildActor({ roles: ['WAREHOUSE'] });
    const prisma = buildPrisma({ actor, stockOnHand: 5, missingShipment: true });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: `/shipments/${SHIPMENT_ID}/complete`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('SHIPMENT_NOT_FOUND');
    expect(prisma.shipmentEvent.create).not.toHaveBeenCalled();
    expect(prisma.actionLog.create).not.toHaveBeenCalled();
    await server.close();
  });

  it('rejects shipment complete for a shipment with unallocated items without writing a SHIPMENT_COMPLETE action log', async () => {
    const actor = buildActor({ roles: ['WAREHOUSE'] });
    const prisma = buildPrisma({ actor, stockOnHand: 5, itemShipmentStatus: 'NOT_SHIPPED', orderId: ORDER_ID });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: `/shipments/${SHIPMENT_ID}/complete`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('SHIPMENT_NOT_PACKED');
    expect(prisma.shipmentEvent.create).not.toHaveBeenCalled();
    expect(prisma.actionLog.create).not.toHaveBeenCalled();
    await server.close();
  });

  it('rejects shipment complete when stock is insufficient and leaves shipment items untouched', async () => {
    const actor = buildActor({ roles: ['WAREHOUSE'] });
    const prisma = buildPrisma({ actor, stockOnHand: 1, itemShipmentStatus: 'PENDING', orderId: ORDER_ID });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: `/shipments/${SHIPMENT_ID}/complete`,
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
  missingShipment?: boolean;
  stockMovementId?: string;
  concurrentOutboundMovementId?: string;
}) {
  const actor = options.actor;
  const shipment = buildShipment({ orderId: options.orderId, itemShipmentStatus: options.itemShipmentStatus });
  if (options.stockMovementId) {
    shipment.items[0].stockMovements = [{ id: options.stockMovementId }];
  }
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
      findUnique: vi.fn(async () => (options.missingShipment ? null : shipment)),
      update: vi.fn(async ({ data }: { data: { orderId?: string; status?: ShipmentStatus } }) => {
        Object.assign(shipment, data, { updatedAt: new Date('2024-03-15T01:00:00.000Z') });
        return shipment;
      }),
    },
    product: {
      findUnique: vi.fn(async () => ({ id: PRODUCT_ID, stockOnHand: options.stockOnHand, shipmentBasedStock: options.stockOnHand })),
      update: vi.fn(async () => ({ id: PRODUCT_ID, stockOnHand: options.stockOnHand - 2, shipmentBasedStock: options.stockOnHand - 2 })),
    },
    orderItem: {
      update: vi.fn(async ({ data }: { data: { shipmentStatus: 'PENDING' | 'COMPLETED' } }) => {
        shipment.items[0].orderItem.shipmentStatus = data.shipmentStatus;
        return shipment.items[0].orderItem;
      }),
    },
    stockMovement: {
      findFirst: vi.fn(async () =>
        options.concurrentOutboundMovementId ? { id: options.concurrentOutboundMovementId } : null,
      ),
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
