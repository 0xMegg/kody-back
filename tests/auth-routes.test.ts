import { describe, expect, it, vi } from 'vitest';
import { buildTestServer } from './helpers.js';
import { hashPassword } from '@/domain/auth/password.js';
import { hashToken, issueAccessToken, issueRefreshToken } from '@/domain/auth/tokens.js';

describe('POST /auth/login', () => {
  it('returns tokens and user summary for valid credentials', async () => {
    const user = {
      id: 'user_1',
      employeeId: 'employee_1',
      email: 'admin@kody.test',
      passwordHash: await hashPassword('Password123'),
      displayName: 'KODY Admin',
      status: 'ACTIVE',
      failedLoginCount: 0,
      lockedUntil: null,
      roles: [{ role: 'ADMIN' }, { role: 'FINANCE' }],
    };
    const prisma = {
      user: {
        findUnique: vi.fn(async () => user),
        update: vi.fn(async () => ({})),
      },
      refreshToken: {
        create: vi.fn(async () => ({})),
      },
      actionLog: {
        create: vi.fn(async () => ({})),
      },
    };
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: 'admin@kody.test',
        password: 'Password123',
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.user).toEqual({
      id: 'user_1',
      employeeId: 'employee_1',
      email: 'admin@kody.test',
      displayName: 'KODY Admin',
      status: 'ACTIVE',
      roles: ['ADMIN', 'FINANCE'],
    });
    expect(body.data.accessToken).toEqual(expect.any(String));
    expect(body.data.refreshToken).toEqual(expect.any(String));

    await server.close();
  });

  it('returns validation error when email is missing', async () => {
    const server = buildTestServer();
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        password: 'Password123',
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');

    await server.close();
  });

  it('returns authentication error for invalid credentials', async () => {
    const user = {
      id: 'user_1',
      employeeId: 'employee_1',
      email: 'admin@kody.test',
      passwordHash: await hashPassword('Password123'),
      displayName: 'KODY Admin',
      status: 'ACTIVE',
      failedLoginCount: 0,
      lockedUntil: null,
      roles: [{ role: 'ADMIN' }],
    };
    const prisma = {
      user: {
        findUnique: vi.fn(async () => user),
        update: vi.fn(async () => ({})),
      },
      refreshToken: {
        create: vi.fn(async () => ({})),
      },
      actionLog: {
        create: vi.fn(async () => ({})),
      },
    };
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: 'admin@kody.test',
        password: 'WrongPassword123',
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(401);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('INVALID_CREDENTIALS');

    await server.close();
  });
});

describe('POST /auth/refresh', () => {
  it('returns a new access token for a valid refresh token', async () => {
    const now = new Date('2026-05-07T12:00:00.000Z');
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(now);

      const user = await buildUser();
      const refreshToken = issueRefreshToken(now);
      const prisma = {
        user: {
          findUnique: vi.fn(async () => user),
          update: vi.fn(async () => ({})),
        },
        refreshToken: {
          findUnique: vi.fn(async () => ({
            id: 'refresh_1',
            userId: user.id,
            tokenHash: refreshToken.tokenHash,
            expiresAt: refreshToken.expiresAt,
            revokedAt: null,
            user,
          })),
          create: vi.fn(async () => ({})),
          update: vi.fn(async () => ({})),
        },
        actionLog: {
          create: vi.fn(async () => ({})),
        },
      };
      const server = buildTestServer(prisma);
      try {
        await server.ready();

        const response = await server.inject({
          method: 'POST',
          url: '/auth/refresh',
          payload: {
            refreshToken: refreshToken.token,
          },
        });
        const body = response.json();

        expect(response.statusCode).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.data.accessToken).toEqual(expect.any(String));
        expect(body.data.user.email).toBe(user.email);
      } finally {
        await server.close();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns 401 REFRESH_TOKEN_EXPIRED when the refresh token has expired', async () => {
    const user = await buildUser();
    const expiredToken = issueRefreshToken(new Date('2020-01-01T00:00:00.000Z'));
    const prisma = {
      user: {
        findUnique: vi.fn(async () => user),
        update: vi.fn(async () => ({})),
      },
      refreshToken: {
        findUnique: vi.fn(async () => ({
          id: 'refresh_1',
          userId: user.id,
          tokenHash: expiredToken.tokenHash,
          expiresAt: expiredToken.expiresAt,
          revokedAt: null,
          user,
        })),
        create: vi.fn(async () => ({})),
        update: vi.fn(async () => ({})),
      },
      actionLog: {
        create: vi.fn(async () => ({})),
      },
    };
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: {
        refreshToken: expiredToken.token,
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(401);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('REFRESH_TOKEN_EXPIRED');

    await server.close();
  });

  it('returns 401 INVALID_REFRESH_TOKEN when the refresh token is revoked', async () => {
    const user = await buildUser();
    const refreshToken = issueRefreshToken(new Date('2026-05-07T00:00:00.000Z'));
    const prisma = {
      user: {
        findUnique: vi.fn(async () => user),
        update: vi.fn(async () => ({})),
      },
      refreshToken: {
        findUnique: vi.fn(async () => ({
          id: 'refresh_1',
          userId: user.id,
          tokenHash: refreshToken.tokenHash,
          expiresAt: refreshToken.expiresAt,
          revokedAt: new Date('2026-05-06T00:00:00.000Z'),
          user,
        })),
        create: vi.fn(async () => ({})),
        update: vi.fn(async () => ({})),
      },
      actionLog: {
        create: vi.fn(async () => ({})),
      },
    };
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: {
        refreshToken: refreshToken.token,
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(401);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('INVALID_REFRESH_TOKEN');

    await server.close();
  });

  it('returns 401 INVALID_REFRESH_TOKEN when the refresh token is unknown', async () => {
    const prisma = {
      user: {
        findUnique: vi.fn(async () => null),
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
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: {
        refreshToken: 'unknown-refresh-token',
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(401);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('INVALID_REFRESH_TOKEN');

    await server.close();
  });
});

describe('POST /auth/logout', () => {
  it('revokes the submitted refresh token', async () => {
    const user = await buildUser();
    const prisma = {
      user: {
        findUnique: vi.fn(async () => user),
        update: vi.fn(async () => ({})),
      },
      refreshToken: {
        findUnique: vi.fn(async () => ({
          id: 'refresh_1',
          userId: user.id,
          tokenHash: hashToken('refresh-token'),
          expiresAt: new Date('2026-05-14T00:00:00.000Z'),
          revokedAt: null,
          user,
        })),
        create: vi.fn(async () => ({})),
        update: vi.fn(async () => ({})),
      },
      actionLog: {
        create: vi.fn(async () => ({})),
      },
    };
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/auth/logout',
      payload: {
        refreshToken: 'refresh-token',
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body).toEqual({ ok: true, data: { revoked: true } });
    expect(prisma.refreshToken.update).toHaveBeenCalledWith({
      where: { id: 'refresh_1' },
      data: { revokedAt: expect.any(Date) },
    });

    await server.close();
  });

  it('returns 401 INVALID_REFRESH_TOKEN when the refresh token is unknown', async () => {
    const prisma = {
      user: {
        findUnique: vi.fn(async () => null),
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
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/auth/logout',
      payload: {
        refreshToken: 'unknown-refresh-token',
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(401);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('INVALID_REFRESH_TOKEN');
    expect(prisma.refreshToken.update).not.toHaveBeenCalled();

    await server.close();
  });

  it('returns 401 INVALID_REFRESH_TOKEN when the refresh token is already revoked', async () => {
    const user = await buildUser();
    const prisma = {
      user: {
        findUnique: vi.fn(async () => user),
        update: vi.fn(async () => ({})),
      },
      refreshToken: {
        findUnique: vi.fn(async () => ({
          id: 'refresh_1',
          userId: user.id,
          tokenHash: hashToken('refresh-token'),
          expiresAt: new Date('2026-05-14T00:00:00.000Z'),
          revokedAt: new Date('2026-05-06T00:00:00.000Z'),
          user,
        })),
        create: vi.fn(async () => ({})),
        update: vi.fn(async () => ({})),
      },
      actionLog: {
        create: vi.fn(async () => ({})),
      },
    };
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/auth/logout',
      payload: {
        refreshToken: 'refresh-token',
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(401);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('INVALID_REFRESH_TOKEN');
    expect(prisma.refreshToken.update).not.toHaveBeenCalled();

    await server.close();
  });
});

describe('GET /auth/me', () => {
  it('returns the current user for a valid bearer token', async () => {
    const user = await buildUser();
    const accessToken = issueAccessToken(
      {
        sub: user.id,
        email: user.email,
        roles: ['ADMIN'],
      },
      'test-secret',
    );
    const prisma = {
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
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/auth/me',
      headers: {
        authorization: `Bearer ${accessToken.token}`,
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.email).toBe(user.email);

    await server.close();
  });

  it('returns validation error when authorization header is missing', async () => {
    const server = buildTestServer();
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/auth/me',
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');

    await server.close();
  });

  it('returns 401 INVALID_ACCESS_TOKEN when the bearer token is malformed', async () => {
    const server = buildTestServer();
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/auth/me',
      headers: {
        authorization: 'Bearer not-a-valid-token',
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(401);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('INVALID_ACCESS_TOKEN');

    await server.close();
  });

  it('returns 401 INVALID_ACCESS_TOKEN when the bearer token signature is invalid', async () => {
    const tamperedToken = issueAccessToken(
      {
        sub: 'user_1',
        email: 'admin@kody.test',
        roles: ['ADMIN'],
      },
      'other-secret',
    );
    const server = buildTestServer();
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/auth/me',
      headers: {
        authorization: `Bearer ${tamperedToken.token}`,
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(401);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('INVALID_ACCESS_TOKEN');

    await server.close();
  });
});

async function buildUser() {
  return {
    id: 'user_1',
    employeeId: 'employee_1',
    email: 'admin@kody.test',
    passwordHash: await hashPassword('Password123'),
    displayName: 'KODY Admin',
    status: 'ACTIVE',
    failedLoginCount: 0,
    lockedUntil: null,
    roles: [{ role: 'ADMIN' }],
  };
}
