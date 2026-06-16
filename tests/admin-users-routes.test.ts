import { describe, expect, it, vi } from 'vitest';
import { issueAccessToken } from '@/domain/auth/tokens.js';
import type { Role, UserStatus } from '@/domain/shared/types.js';
import { buildTestServer } from './helpers.js';

describe('admin user routes', () => {
  it('allows ADMIN to list users', async () => {
    const actor = buildUser({ id: 'admin_1', roles: ['ADMIN'] });
    const target = buildUser({ id: 'user_1', roles: ['SALES'] });
    const prisma = buildPrisma({ actor, target });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/admin/users',
      headers: {
        authorization: `Bearer ${issueToken(actor.id, actor.roles)}`,
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      id: target.id,
      email: target.email,
      loginId: target.loginId,
      roles: ['SALES'],
      employee: {
        id: target.employee.id,
        name: target.employee.name,
      },
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.actionLog.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('returns the user detail body shape and does not log read-only access on GET /admin/users/:id', async () => {
    const actor = buildUser({ id: 'admin_1', roles: ['ADMIN'] });
    const target = buildUser({ id: 'user_1', roles: ['SALES'] });
    const prisma = buildPrisma({ actor, target });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: `/admin/users/${target.id}`,
      headers: {
        authorization: `Bearer ${issueToken(actor.id, actor.roles)}`,
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data).toMatchObject({
      id: target.id,
      email: target.email,
      loginId: target.loginId,
      roles: ['SALES'],
      employee: {
        id: target.employee.id,
        name: target.employee.name,
      },
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.actionLog.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('returns USER_NOT_FOUND when an admin reads an unknown user detail', async () => {
    const actor = buildUser({ id: 'admin_1', roles: ['ADMIN'] });
    const target = buildUser({ id: 'user_1', roles: ['SALES'] });
    const prisma = buildPrisma({ actor, target });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/admin/users/missing_user',
      headers: {
        authorization: `Bearer ${issueToken(actor.id, actor.roles)}`,
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('USER_NOT_FOUND');
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.actionLog.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('allows FINANCE to replace user roles and writes an ActionLog', async () => {
    const actor = buildUser({ id: 'finance_1', roles: ['FINANCE'] });
    const target = buildUser({ id: 'user_1', roles: ['SALES'] });
    const prisma = buildPrisma({
      actor,
      target,
      updateUser: {
        ...target,
        roles: [{ role: 'OPERATIONS' }, { role: 'WAREHOUSE' }],
      },
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'PUT',
      url: `/admin/users/${target.id}/roles`,
      headers: {
        authorization: `Bearer ${issueToken(actor.id, actor.roles)}`,
      },
      payload: {
        roles: ['OPERATIONS', 'WAREHOUSE'],
        reason: 'team transfer',
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.roles).toEqual(['OPERATIONS', 'WAREHOUSE']);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: target.id },
      data: {
        roles: {
          deleteMany: {},
          create: [{ role: 'OPERATIONS' }, { role: 'WAREHOUSE' }],
        },
      },
      include: { employee: true, roles: true },
    });
    expect(prisma.actionLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.actionLog.create).toHaveBeenCalledWith({
      data: {
        actorUserId: actor.id,
        actionType: 'USER_ROLE_CHANGE',
        targetType: 'User',
        targetId: target.id,
        beforeJson: { roles: ['SALES'] },
        afterJson: { roles: ['OPERATIONS', 'WAREHOUSE'] },
        metadataJson: { reason: 'team transfer', requestId: expect.any(String) },
        ipAddress: '127.0.0.1',
        userAgent: 'lightMyRequest',
      },
    });

    await server.close();
  });

  it('does not log when role replacement is a no-op', async () => {
    const actor = buildUser({ id: 'admin_1', roles: ['ADMIN'] });
    const target = buildUser({ id: 'user_1', roles: ['SALES'] });
    const prisma = buildPrisma({ actor, target });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'PUT',
      url: `/admin/users/${target.id}/roles`,
      headers: {
        authorization: `Bearer ${issueToken(actor.id, actor.roles)}`,
      },
      payload: {
        roles: ['SALES'],
        reason: 'noop',
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.roles).toEqual(['SALES']);
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.actionLog.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('does not log when role replacement reorders the same role set', async () => {
    const actor = buildUser({ id: 'admin_1', roles: ['ADMIN'] });
    const target = buildUser({ id: 'user_1', roles: ['SALES', 'OPERATIONS'] });
    const prisma = buildPrisma({ actor, target });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'PUT',
      url: `/admin/users/${target.id}/roles`,
      headers: {
        authorization: `Bearer ${issueToken(actor.id, actor.roles)}`,
      },
      payload: {
        roles: ['OPERATIONS', 'SALES'],
        reason: 'reorder',
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.roles).toEqual(['SALES', 'OPERATIONS']);
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.actionLog.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('rejects operational roles from admin user writes', async () => {
    const actor = buildUser({ id: 'ops_1', roles: ['OPERATIONS'] });
    const target = buildUser({ id: 'user_1', roles: ['SALES'] });
    const prisma = buildPrisma({ actor, target });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'PATCH',
      url: `/admin/users/${target.id}/status`,
      headers: {
        authorization: `Bearer ${issueToken(actor.id, actor.roles)}`,
      },
      payload: {
        status: 'SUSPENDED',
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(403);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('AUTHORIZATION_ERROR');
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.actionLog.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('updates status and writes an ActionLog', async () => {
    const actor = buildUser({ id: 'admin_1', roles: ['ADMIN'] });
    const target = buildUser({ id: 'user_1', roles: ['SALES'], status: 'ACTIVE' });
    const prisma = buildPrisma({
      actor,
      target,
      updateUser: {
        ...target,
        status: 'SUSPENDED',
      },
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'PATCH',
      url: `/admin/users/${target.id}/status`,
      headers: {
        authorization: `Bearer ${issueToken(actor.id, actor.roles)}`,
      },
      payload: {
        status: 'SUSPENDED',
        reason: 'policy review',
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.status).toBe('SUSPENDED');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: target.id },
      data: { status: 'SUSPENDED' },
      include: { employee: true, roles: true },
    });
    expect(prisma.actionLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.actionLog.create).toHaveBeenCalledWith({
      data: {
        actorUserId: actor.id,
        actionType: 'USER_STATUS_CHANGE',
        targetType: 'User',
        targetId: target.id,
        beforeJson: { status: 'ACTIVE' },
        afterJson: { status: 'SUSPENDED' },
        metadataJson: { reason: 'policy review', requestId: expect.any(String) },
        ipAddress: '127.0.0.1',
        userAgent: 'lightMyRequest',
      },
    });

    await server.close();
  });

  it('does not log when status update is a no-op', async () => {
    const actor = buildUser({ id: 'admin_1', roles: ['ADMIN'] });
    const target = buildUser({ id: 'user_1', roles: ['SALES'], status: 'ACTIVE' });
    const prisma = buildPrisma({ actor, target });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'PATCH',
      url: `/admin/users/${target.id}/status`,
      headers: {
        authorization: `Bearer ${issueToken(actor.id, actor.roles)}`,
      },
      payload: {
        status: 'ACTIVE',
        reason: 'noop',
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.status).toBe('ACTIVE');
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.actionLog.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('rejects role replacement from operational roles without writing an ActionLog', async () => {
    const actor = buildUser({ id: 'ops_1', roles: ['OPERATIONS'] });
    const target = buildUser({ id: 'user_1', roles: ['SALES'] });
    const prisma = buildPrisma({ actor, target });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'PUT',
      url: `/admin/users/${target.id}/roles`,
      headers: {
        authorization: `Bearer ${issueToken(actor.id, actor.roles)}`,
      },
      payload: {
        roles: ['OPERATIONS'],
        reason: 'unauthorized',
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(403);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('AUTHORIZATION_ERROR');
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.actionLog.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('unlocks a locked user without writing an ActionLog', async () => {
    const actor = buildUser({ id: 'admin_1', roles: ['ADMIN'] });
    const target = buildUser({
      id: 'user_1',
      roles: ['SALES'],
      failedLoginCount: 5,
      lockedUntil: new Date('2026-05-07T12:00:00.000Z'),
    });
    const prisma = buildPrisma({
      actor,
      target,
      updateUser: {
        ...target,
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: `/admin/users/${target.id}/unlock`,
      headers: {
        authorization: `Bearer ${issueToken(actor.id, actor.roles)}`,
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.failedLoginCount).toBe(0);
    expect(body.data.lockedUntil).toBeNull();
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: target.id },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
      },
      include: { employee: true, roles: true },
    });
    expect(prisma.actionLog.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('allows FINANCE to update status and writes an ActionLog', async () => {
    const actor = buildUser({ id: 'finance_1', roles: ['FINANCE'] });
    const target = buildUser({ id: 'user_1', roles: ['SALES'], status: 'ACTIVE' });
    const prisma = buildPrisma({
      actor,
      target,
      updateUser: {
        ...target,
        status: 'SUSPENDED',
      },
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'PATCH',
      url: `/admin/users/${target.id}/status`,
      headers: {
        authorization: `Bearer ${issueToken(actor.id, actor.roles)}`,
      },
      payload: {
        status: 'SUSPENDED',
        reason: 'finance review',
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.status).toBe('SUSPENDED');
    expect(prisma.user.update).toHaveBeenCalled();
    expect(prisma.actionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorUserId: actor.id,
          actionType: 'USER_STATUS_CHANGE',
          targetId: target.id,
        }),
      }),
    );

    await server.close();
  });

  it('allows ADMIN to replace user roles and writes an ActionLog', async () => {
    const actor = buildUser({ id: 'admin_1', roles: ['ADMIN'] });
    const target = buildUser({ id: 'user_1', roles: ['SALES'] });
    const prisma = buildPrisma({
      actor,
      target,
      updateUser: {
        ...target,
        roles: [{ role: 'OPERATIONS' }],
      },
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'PUT',
      url: `/admin/users/${target.id}/roles`,
      headers: {
        authorization: `Bearer ${issueToken(actor.id, actor.roles)}`,
      },
      payload: {
        roles: ['OPERATIONS'],
        reason: 'reassignment',
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.roles).toEqual(['OPERATIONS']);
    expect(prisma.user.update).toHaveBeenCalled();
    expect(prisma.actionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorUserId: actor.id,
          actionType: 'USER_ROLE_CHANGE',
          targetId: target.id,
        }),
      }),
    );

    await server.close();
  });

  it('allows FINANCE to unlock a locked user without writing an ActionLog', async () => {
    const actor = buildUser({ id: 'finance_1', roles: ['FINANCE'] });
    const target = buildUser({
      id: 'user_1',
      roles: ['SALES'],
      failedLoginCount: 5,
      lockedUntil: new Date('2026-05-07T12:00:00.000Z'),
    });
    const prisma = buildPrisma({
      actor,
      target,
      updateUser: {
        ...target,
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: `/admin/users/${target.id}/unlock`,
      headers: {
        authorization: `Bearer ${issueToken(actor.id, actor.roles)}`,
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.failedLoginCount).toBe(0);
    expect(body.data.lockedUntil).toBeNull();
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: target.id },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
      },
      include: { employee: true, roles: true },
    });
    expect(prisma.actionLog.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('rejects unlock from operational roles without writing an ActionLog', async () => {
    const actor = buildUser({ id: 'ops_1', roles: ['OPERATIONS'] });
    const target = buildUser({
      id: 'user_1',
      roles: ['SALES'],
      failedLoginCount: 5,
      lockedUntil: new Date('2026-05-07T12:00:00.000Z'),
    });
    const prisma = buildPrisma({ actor, target });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: `/admin/users/${target.id}/unlock`,
      headers: {
        authorization: `Bearer ${issueToken(actor.id, actor.roles)}`,
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(403);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('AUTHORIZATION_ERROR');
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.actionLog.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('rejects suspended elevated actors from admin user writes before update or log', async () => {
    const actor = buildUser({ id: 'admin_1', roles: ['ADMIN'], status: 'SUSPENDED' });
    const target = buildUser({ id: 'user_1', roles: ['SALES'], status: 'ACTIVE' });
    const prisma = buildPrisma({ actor, target });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'PATCH',
      url: `/admin/users/${target.id}/status`,
      headers: {
        authorization: `Bearer ${issueToken(actor.id, actor.roles)}`,
      },
      payload: {
        status: 'SUSPENDED',
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(403);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('USER_INACTIVE');
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.actionLog.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('rejects PATCH /admin/users/:id/status with missing status as VALIDATION_ERROR', async () => {
    const actor = buildUser({ id: 'admin_1', roles: ['ADMIN'] });
    const target = buildUser({ id: 'user_1', roles: ['SALES'] });
    const prisma = buildPrisma({ actor, target });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'PATCH',
      url: `/admin/users/${target.id}/status`,
      headers: {
        authorization: `Bearer ${issueToken(actor.id, actor.roles)}`,
      },
      payload: {
        reason: 'missing status',
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.actionLog.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('rejects PUT /admin/users/:id/roles when roles is not an array as VALIDATION_ERROR', async () => {
    const actor = buildUser({ id: 'admin_1', roles: ['ADMIN'] });
    const target = buildUser({ id: 'user_1', roles: ['SALES'] });
    const prisma = buildPrisma({ actor, target });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'PUT',
      url: `/admin/users/${target.id}/roles`,
      headers: {
        authorization: `Bearer ${issueToken(actor.id, actor.roles)}`,
      },
      payload: {
        roles: 'OPERATIONS',
        reason: 'invalid roles',
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.actionLog.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('rejects PUT /admin/users/:id/roles with empty roles as INVALID_USER_ROLES', async () => {
    const actor = buildUser({ id: 'admin_1', roles: ['ADMIN'] });
    const target = buildUser({ id: 'user_1', roles: ['SALES'] });
    const prisma = buildPrisma({ actor, target });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'PUT',
      url: `/admin/users/${target.id}/roles`,
      headers: {
        authorization: `Bearer ${issueToken(actor.id, actor.roles)}`,
      },
      payload: {
        roles: [],
        reason: 'empty roles',
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('INVALID_USER_ROLES');
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.actionLog.create).not.toHaveBeenCalled();

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

function buildUser(input: {
  id: string;
  roles: Role[];
  status?: UserStatus;
  failedLoginCount?: number;
  lockedUntil?: Date | null;
}) {
  return {
    id: input.id,
    employeeId: `${input.id}_employee`,
    email: `${input.id}@kody.test`,
    loginId: input.id,
    passwordHash: 'unused',
    displayName: `User ${input.id}`,
    profileImageUrl: null,
    status: input.status ?? 'ACTIVE',
    failedLoginCount: input.failedLoginCount ?? 0,
    lockedUntil: input.lockedUntil ?? null,
    lastLoginAt: null,
    createdAt: new Date('2026-05-07T00:00:00.000Z'),
    updatedAt: new Date('2026-05-07T00:00:00.000Z'),
    roles: input.roles.map((role) => ({ role })),
    employee: {
      id: `${input.id}_employee`,
      name: `Employee ${input.id}`,
      email: `${input.id}@kody.test`,
      phone: null,
      department: 'Ops',
      position: 'Manager',
      status: 'ACTIVE',
    },
  };
}

function buildPrisma(input: {
  actor: ReturnType<typeof buildUser>;
  target: ReturnType<typeof buildUser>;
  updateUser?: ReturnType<typeof buildUser>;
}) {
  const findUser = (id: string) => {
    if (id === input.actor.id) {
      return input.actor;
    }

    if (id === input.target.id) {
      return input.target;
    }

    return null;
  };

  return {
    user: {
      findMany: vi.fn(async () => [input.target]),
      findUnique: vi.fn(async (args: { where: { id: string } }) => findUser(args.where.id)),
      update: vi.fn(async () => input.updateUser ?? input.target),
    },
    refreshToken: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
    },
    actionLog: {
      create: vi.fn(async () => ({})),
    },
  };
}
