import { describe, expect, it, vi } from 'vitest';
import { buildTestServer } from './helpers.js';
import { issueAccessToken } from '@/domain/auth/tokens.js';
import { requirePermission, type AuthenticatedRequest } from '@/server/auth/guards.js';
import { successResponse } from '@/server/api/index.js';
import type { Role, UserStatus } from '@/domain/shared/types.js';

describe('auth guards', () => {
  it('allows a request when the bearer user has the required permission', async () => {
    const user = buildUser({ roles: [{ role: 'WAREHOUSE' }] });
    const server = buildTestServer(buildPrisma(user));
    server.get(
      '/test-shipment-execute',
      { preHandler: requirePermission({ resource: 'shipment', action: 'execute' }) },
      async (request) => successResponse({ userId: (request as AuthenticatedRequest).authUser.id }),
    );
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/test-shipment-execute',
      headers: {
        authorization: `Bearer ${issueToken(user.id, ['WAREHOUSE'])}`,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, data: { userId: user.id } });

    await server.close();
  });

  it('rejects a request when the bearer user lacks the required permission', async () => {
    const user = buildUser({ roles: [{ role: 'SALES' }] });
    const server = buildTestServer(buildPrisma(user));
    server.get(
      '/test-payment-write',
      { preHandler: requirePermission({ resource: 'payment', action: 'write' }) },
      async () => successResponse({ ok: true }),
    );
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/test-payment-write',
      headers: {
        authorization: `Bearer ${issueToken(user.id, ['SALES'])}`,
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(403);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('AUTHORIZATION_ERROR');

    await server.close();
  });

  it('allows FINANCE through a route-level write permission boundary (payment:write)', async () => {
    const user = buildUser({ roles: [{ role: 'FINANCE' }] });
    const server = buildTestServer(buildPrisma(user));
    server.get(
      '/test-payment-write',
      { preHandler: requirePermission({ resource: 'payment', action: 'write' }) },
      async (request) => successResponse({ userId: (request as AuthenticatedRequest).authUser.id }),
    );
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/test-payment-write',
      headers: {
        authorization: `Bearer ${issueToken(user.id, ['FINANCE'])}`,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, data: { userId: user.id } });

    await server.close();
  });

  it('rejects a request without authorization header', async () => {
    const server = buildTestServer();
    server.get(
      '/test-profile',
      { preHandler: requirePermission({ resource: 'profile', action: 'read' }) },
      async () => successResponse({ ok: true }),
    );
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/test-profile',
    });
    const body = response.json();

    expect(response.statusCode).toBe(401);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('AUTHENTICATION_ERROR');

    await server.close();
  });

  it('rejects when the authorization scheme is not Bearer', async () => {
    const server = buildTestServer();
    server.get(
      '/test-profile',
      { preHandler: requirePermission({ resource: 'profile', action: 'read' }) },
      async () => successResponse({ ok: true }),
    );
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/test-profile',
      headers: {
        authorization: 'Basic dXNlcjpwYXNz',
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');

    await server.close();
  });

  it('rejects when the bearer token is missing after the scheme', async () => {
    const server = buildTestServer();
    server.get(
      '/test-profile',
      { preHandler: requirePermission({ resource: 'profile', action: 'read' }) },
      async () => successResponse({ ok: true }),
    );
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/test-profile',
      headers: {
        authorization: 'Bearer ',
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');

    await server.close();
  });

  it('rejects when the access token signature is invalid', async () => {
    const user = buildUser({ roles: [{ role: 'WAREHOUSE' }] });
    const server = buildTestServer(buildPrisma(user));
    server.get(
      '/test-profile',
      { preHandler: requirePermission({ resource: 'profile', action: 'read' }) },
      async () => successResponse({ ok: true }),
    );
    await server.ready();

    const tamperedToken = issueAccessToken(
      { sub: user.id, email: user.email, roles: ['WAREHOUSE'] },
      'wrong-secret',
    ).token;

    const response = await server.inject({
      method: 'GET',
      url: '/test-profile',
      headers: {
        authorization: `Bearer ${tamperedToken}`,
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(401);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('INVALID_ACCESS_TOKEN');

    await server.close();
  });

  it('rejects an INACTIVE user even when the role grants the permission', async () => {
    const user = buildUser({ roles: [{ role: 'WAREHOUSE' }], status: 'INACTIVE' });
    const server = buildTestServer(buildPrisma(user));
    server.get(
      '/test-shipment-execute',
      { preHandler: requirePermission({ resource: 'shipment', action: 'execute' }) },
      async () => successResponse({ ok: true }),
    );
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/test-shipment-execute',
      headers: {
        authorization: `Bearer ${issueToken(user.id, ['WAREHOUSE'])}`,
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(403);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('USER_INACTIVE');

    await server.close();
  });

  it('rejects an INACTIVE user with elevated roles (ADMIN)', async () => {
    const user = buildUser({ roles: [{ role: 'ADMIN' }], status: 'INACTIVE' });
    const server = buildTestServer(buildPrisma(user));
    server.get(
      '/test-userAdmin-write',
      { preHandler: requirePermission({ resource: 'userAdmin', action: 'write' }) },
      async () => successResponse({ ok: true }),
    );
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/test-userAdmin-write',
      headers: {
        authorization: `Bearer ${issueToken(user.id, ['ADMIN'])}`,
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(403);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('USER_INACTIVE');

    await server.close();
  });

  it('rejects a SUSPENDED user even when the role grants the permission', async () => {
    const user = buildUser({ roles: [{ role: 'OPERATIONS' }], status: 'SUSPENDED' });
    const server = buildTestServer(buildPrisma(user));
    server.get(
      '/test-account-write',
      { preHandler: requirePermission({ resource: 'account', action: 'write' }) },
      async () => successResponse({ ok: true }),
    );
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/test-account-write',
      headers: {
        authorization: `Bearer ${issueToken(user.id, ['OPERATIONS'])}`,
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(403);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('USER_INACTIVE');

    await server.close();
  });

  it('rejects a locked user even when the role grants the permission', async () => {
    const lockedUntil = new Date(Date.now() + 60 * 60 * 1000);
    const user = buildUser({ roles: [{ role: 'WAREHOUSE' }], lockedUntil });
    const server = buildTestServer(buildPrisma(user));
    server.get(
      '/test-shipment-execute',
      { preHandler: requirePermission({ resource: 'shipment', action: 'execute' }) },
      async () => successResponse({ ok: true }),
    );
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/test-shipment-execute',
      headers: {
        authorization: `Bearer ${issueToken(user.id, ['WAREHOUSE'])}`,
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(423);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('ACCOUNT_LOCKED');

    await server.close();
  });

  it('rejects a locked user with elevated roles (FINANCE)', async () => {
    const lockedUntil = new Date(Date.now() + 60 * 60 * 1000);
    const user = buildUser({ roles: [{ role: 'FINANCE' }], lockedUntil });
    const server = buildTestServer(buildPrisma(user));
    server.get(
      '/test-payment-write',
      { preHandler: requirePermission({ resource: 'payment', action: 'write' }) },
      async () => successResponse({ ok: true }),
    );
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/test-payment-write',
      headers: {
        authorization: `Bearer ${issueToken(user.id, ['FINANCE'])}`,
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(423);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('ACCOUNT_LOCKED');

    await server.close();
  });

  it('prefers status check over lock check when both apply (status-first priority)', async () => {
    const lockedUntil = new Date(Date.now() + 60 * 60 * 1000);
    const user = buildUser({
      roles: [{ role: 'ADMIN' }],
      status: 'INACTIVE',
      lockedUntil,
    });
    const server = buildTestServer(buildPrisma(user));
    server.get(
      '/test-userAdmin-write',
      { preHandler: requirePermission({ resource: 'userAdmin', action: 'write' }) },
      async () => successResponse({ ok: true }),
    );
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/test-userAdmin-write',
      headers: {
        authorization: `Bearer ${issueToken(user.id, ['ADMIN'])}`,
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(403);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('USER_INACTIVE');

    await server.close();
  });
});

function issueToken(userId: string, roles: Role[] = ['SALES']): string {
  return issueAccessToken(
    {
      sub: userId,
      email: 'user@kody.test',
      roles,
    },
    'test-secret',
  ).token;
}

function buildUser(
  overrides: {
    roles?: { role: Role }[];
    status?: UserStatus;
    lockedUntil?: Date | null;
  } = {},
) {
  return {
    id: 'user_1',
    employeeId: 'employee_1',
    email: 'user@kody.test',
    passwordHash: 'unused',
    displayName: 'KODY User',
    status: overrides.status ?? 'ACTIVE',
    failedLoginCount: 0,
    lockedUntil: overrides.lockedUntil ?? null,
    roles: overrides.roles ?? [{ role: 'SALES' }],
  };
}

function buildPrisma(user: ReturnType<typeof buildUser>) {
  return {
    user: {
      findUnique: vi.fn(async () => user),
      update: vi.fn(async () => ({})),
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
