import { describe, expect, it, vi } from 'vitest';
import { issueAccessToken } from '@/domain/auth/tokens.js';
import type { ActionType, Role, UserStatus } from '@/domain/shared/types.js';
import { buildTestServer } from './helpers.js';

describe('logs routes', () => {
  it('rejects requests without an authorization header as AUTHENTICATION_ERROR', async () => {
    const prisma = buildPrisma({ actor: buildActor() });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({ method: 'GET', url: '/logs' });
    const body = response.json();

    expect(response.statusCode).toBe(401);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('AUTHENTICATION_ERROR');
    expect(prisma.actionLog.findMany).not.toHaveBeenCalled();
    expect(prisma.actionLog.count).not.toHaveBeenCalled();

    await server.close();
  });

  it('rejects requests when the authorization scheme is not Bearer as VALIDATION_ERROR', async () => {
    const prisma = buildPrisma({ actor: buildActor() });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/logs',
      headers: { authorization: 'Basic dXNlcjpwYXNz' },
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(prisma.actionLog.findMany).not.toHaveBeenCalled();

    await server.close();
  });

  it('allows ADMIN to read all logs with no row-level narrowing and forwards filters verbatim', async () => {
    const actor = buildActor({ id: 'admin_1', roles: ['ADMIN'] });
    const items = [
      buildLog({ id: 'log_1', actorUserId: 'someone_else', targetType: 'User' }),
      buildLog({ id: 'log_2', actorUserId: 'someone_else', targetType: 'Order' }),
    ];
    const prisma = buildPrisma({ actor, items, total: 2 });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/logs?page=1&pageSize=50&actorUserId=someone_else&actionType=ORDER_CREATE&targetType=Order&targetId=order_1',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.items).toHaveLength(2);
    expect(body.data.items[0]).toEqual({
      id: 'log_1',
      actorUserId: 'someone_else',
      actionType: 'ORDER_CREATE',
      targetType: 'User',
      targetId: 'target_1',
      beforeJson: null,
      afterJson: null,
      metadataJson: null,
      ipAddress: null,
      userAgent: null,
      createdAt: '2026-05-12T00:00:00.000Z',
    });
    expect(body.data.pagination).toEqual({
      page: 1,
      pageSize: 50,
      total: 2,
      totalPages: 1,
    });
    const expectedWhere = {
      actorUserId: 'someone_else',
      actionType: 'ORDER_CREATE',
      targetType: 'Order',
      targetId: 'order_1',
    };
    expect(prisma.actionLog.findMany).toHaveBeenCalledWith({
      where: expectedWhere,
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 50,
    });
    expect(prisma.actionLog.count).toHaveBeenCalledWith({ where: expectedWhere });

    await server.close();
  });

  it('applies default pagination when query params are omitted', async () => {
    const actor = buildActor({ id: 'admin_1', roles: ['ADMIN'] });
    const prisma = buildPrisma({ actor, items: [], total: 0 });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/logs',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.data.pagination).toEqual({
      page: 1,
      pageSize: 20,
      total: 0,
      totalPages: 0,
    });
    expect(prisma.actionLog.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 20,
    });

    await server.close();
  });

  it('computes skip/take/totalPages for paginated reads', async () => {
    const actor = buildActor({ id: 'admin_1', roles: ['ADMIN'] });
    const prisma = buildPrisma({ actor, items: [], total: 45 });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/logs?page=3&pageSize=10',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.data.pagination).toEqual({
      page: 3,
      pageSize: 10,
      total: 45,
      totalPages: 5,
    });
    expect(prisma.actionLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 10 }),
    );

    await server.close();
  });

  it('allows FINANCE to read all logs with filters', async () => {
    const actor = buildActor({ id: 'finance_1', roles: ['FINANCE'] });
    const prisma = buildPrisma({ actor, items: [], total: 0 });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/logs?targetType=User&targetId=user_42',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });

    expect(response.statusCode).toBe(200);
    expect(prisma.actionLog.findMany).toHaveBeenCalledWith({
      where: { targetType: 'User', targetId: 'user_42' },
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 20,
    });

    await server.close();
  });

  it('restricts SALES without filters to own logs plus mapped readable target types', async () => {
    const actor = buildActor({ id: 'sales_1', roles: ['SALES'] });
    const prisma = buildPrisma({ actor, items: [], total: 0 });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/logs',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });

    expect(response.statusCode).toBe(200);
    const [findManyCall] = prisma.actionLog.findMany.mock.calls;
    const where = findManyCall?.[0]?.where as {
      OR: Array<Record<string, unknown>>;
    };
    expect(where.OR).toBeDefined();
    expect(where.OR[0]).toEqual({ actorUserId: actor.id });
    const targetInClause = where.OR[1] as { targetType: { in: string[] } };
    expect(targetInClause.targetType.in).toEqual(
      expect.arrayContaining([
        'Account',
        'ShippingAddress',
        'AccountRelation',
        'Product',
        'StockMovement',
        'Payment',
        'FxRate',
        'Order',
        'OrderItem',
        'Shipment',
        'ShipmentItem',
      ]),
    );
    expect(targetInClause.targetType.in).not.toContain('User');
    expect(targetInClause.targetType.in).not.toContain('Employee');

    await server.close();
  });

  it('allows SALES to filter by mapped readable targetType (Account/Order/Payment)', async () => {
    const actor = buildActor({ id: 'sales_1', roles: ['SALES'] });
    const prisma = buildPrisma({ actor, items: [], total: 0 });
    const server = buildTestServer(prisma);
    await server.ready();

    for (const targetType of ['Account', 'Order', 'Payment'] as const) {
      const response = await server.inject({
        method: 'GET',
        url: `/logs?targetType=${targetType}`,
        headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      });

      expect(response.statusCode).toBe(200);
      expect(prisma.actionLog.findMany).toHaveBeenLastCalledWith({
        where: { targetType },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 20,
      });
    }

    await server.close();
  });

  it('allows WAREHOUSE to read Shipment, Order, Product, and Payment target logs', async () => {
    const actor = buildActor({ id: 'warehouse_1', roles: ['WAREHOUSE'] });
    const prisma = buildPrisma({ actor, items: [], total: 0 });
    const server = buildTestServer(prisma);
    await server.ready();

    for (const targetType of ['Shipment', 'Order', 'Product', 'Payment'] as const) {
      const response = await server.inject({
        method: 'GET',
        url: `/logs?targetType=${targetType}`,
        headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      });

      expect(response.statusCode).toBe(200);
      expect(prisma.actionLog.findMany).toHaveBeenLastCalledWith({
        where: { targetType },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 20,
      });
    }

    await server.close();
  });

  it('rejects non-admin targetType=User as AUTHORIZATION_ERROR when actor filter is not self', async () => {
    const actor = buildActor({ id: 'sales_1', roles: ['SALES'] });
    const prisma = buildPrisma({ actor, items: [], total: 0 });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/logs?targetType=User',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });
    const body = response.json();

    expect(response.statusCode).toBe(403);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('AUTHORIZATION_ERROR');
    expect(prisma.actionLog.findMany).not.toHaveBeenCalled();
    expect(prisma.actionLog.count).not.toHaveBeenCalled();

    await server.close();
  });

  it('allows non-admin targetType=User when actorUserId filter matches self (self-only)', async () => {
    const actor = buildActor({ id: 'sales_1', roles: ['SALES'] });
    const prisma = buildPrisma({ actor, items: [], total: 0 });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: `/logs?targetType=User&actorUserId=${actor.id}`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });

    expect(response.statusCode).toBe(200);
    expect(prisma.actionLog.findMany).toHaveBeenCalledWith({
      where: { actorUserId: actor.id, targetType: 'User' },
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 20,
    });

    await server.close();
  });

  it('rejects non-admin unknown targetType when actor is not self', async () => {
    const actor = buildActor({ id: 'sales_1', roles: ['SALES'] });
    const prisma = buildPrisma({ actor, items: [], total: 0 });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/logs?targetType=MysterySource',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });
    const body = response.json();

    expect(response.statusCode).toBe(403);
    expect(body.error.code).toBe('AUTHORIZATION_ERROR');
    expect(prisma.actionLog.findMany).not.toHaveBeenCalled();

    await server.close();
  });

  it('restricts non-admin actorUserId filter to readable targets when actorUserId is not self', async () => {
    const actor = buildActor({ id: 'sales_1', roles: ['SALES'] });
    const prisma = buildPrisma({ actor, items: [], total: 0 });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/logs?actorUserId=other_user',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });

    expect(response.statusCode).toBe(200);
    const [findManyCall] = prisma.actionLog.findMany.mock.calls;
    const where = findManyCall?.[0]?.where as {
      actorUserId: string;
      targetType: { in: string[] };
    };
    expect(where.actorUserId).toBe('other_user');
    expect(where.targetType.in).toEqual(
      expect.arrayContaining(['Account', 'Order', 'Payment']),
    );
    expect(where.targetType.in).not.toContain('User');

    await server.close();
  });

  it('rejects invalid page as VALIDATION_ERROR', async () => {
    const actor = buildActor({ id: 'admin_1', roles: ['ADMIN'] });
    const prisma = buildPrisma({ actor, items: [], total: 0 });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/logs?page=abc',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(prisma.actionLog.findMany).not.toHaveBeenCalled();

    await server.close();
  });

  it('rejects page=0 as VALIDATION_ERROR', async () => {
    const actor = buildActor({ id: 'admin_1', roles: ['ADMIN'] });
    const prisma = buildPrisma({ actor, items: [], total: 0 });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/logs?page=0',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });

    expect(response.statusCode).toBe(400);
    expect(prisma.actionLog.findMany).not.toHaveBeenCalled();

    await server.close();
  });

  it('rejects pageSize above the upper bound as VALIDATION_ERROR', async () => {
    const actor = buildActor({ id: 'admin_1', roles: ['ADMIN'] });
    const prisma = buildPrisma({ actor, items: [], total: 0 });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/logs?pageSize=999',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });

    expect(response.statusCode).toBe(400);
    expect(prisma.actionLog.findMany).not.toHaveBeenCalled();

    await server.close();
  });

  it('rejects unknown actionType as VALIDATION_ERROR', async () => {
    const actor = buildActor({ id: 'admin_1', roles: ['ADMIN'] });
    const prisma = buildPrisma({ actor, items: [], total: 0 });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/logs?actionType=BOGUS',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });

    expect(response.statusCode).toBe(400);
    expect(prisma.actionLog.findMany).not.toHaveBeenCalled();

    await server.close();
  });

  it('serializes createdAt as ISO 8601 string', async () => {
    const actor = buildActor({ id: 'admin_1', roles: ['ADMIN'] });
    const item = buildLog({
      id: 'log_1',
      actorUserId: actor.id,
      createdAt: new Date('2026-04-30T13:24:56.789Z'),
    });
    const prisma = buildPrisma({ actor, items: [item], total: 1 });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/logs',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.data.items[0].createdAt).toBe('2026-04-30T13:24:56.789Z');

    await server.close();
  });
});

function issueToken(userId: string, roles: Role[]): string {
  return issueAccessToken(
    {
      sub: userId,
      email: `${userId}@kody.test`,
      roles,
    },
    'test-secret',
  ).token;
}

function buildActor(
  input: { id?: string; roles?: Role[]; status?: UserStatus } = {},
) {
  const id = input.id ?? 'user_1';
  return {
    id,
    employeeId: `${id}_employee`,
    email: `${id}@kody.test`,
    passwordHash: 'unused',
    displayName: `User ${id}`,
    profileImageUrl: null,
    status: input.status ?? 'ACTIVE',
    failedLoginCount: 0,
    lockedUntil: null,
    lastLoginAt: null,
    createdAt: new Date('2026-05-07T00:00:00.000Z'),
    updatedAt: new Date('2026-05-07T00:00:00.000Z'),
    roles: (input.roles ?? ['SALES']).map((role) => ({ role })),
  };
}

interface LogOverrides {
  id?: string;
  actorUserId?: string | null;
  actionType?: ActionType;
  targetType?: string;
  targetId?: string | null;
  createdAt?: Date;
}

function buildLog(overrides: LogOverrides = {}) {
  return {
    id: overrides.id ?? 'log_1',
    actorUserId: overrides.actorUserId ?? null,
    actionType: overrides.actionType ?? 'ORDER_CREATE',
    targetType: overrides.targetType ?? 'User',
    targetId: overrides.targetId ?? 'target_1',
    beforeJson: null,
    afterJson: null,
    metadataJson: null,
    ipAddress: null,
    userAgent: null,
    createdAt: overrides.createdAt ?? new Date('2026-05-12T00:00:00.000Z'),
  };
}

function buildPrisma(input: {
  actor: ReturnType<typeof buildActor>;
  items?: ReturnType<typeof buildLog>[];
  total?: number;
}) {
  const items = input.items ?? [];
  const total = input.total ?? items.length;

  return {
    user: {
      findUnique: vi.fn(async (args: { where: { id?: string } }) => {
        if (args.where.id === input.actor.id) {
          return input.actor;
        }
        return null;
      }),
      update: vi.fn(async () => ({})),
    },
    refreshToken: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
    },
    actionLog: {
      create: vi.fn(async () => ({})),
      findMany: vi.fn(async () => items),
      count: vi.fn(async () => total),
    },
  };
}
