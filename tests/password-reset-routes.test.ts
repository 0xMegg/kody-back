import { describe, expect, it, vi } from 'vitest';
import { hashPasswordResetToken } from '@/domain/auth/tokens.js';
import { buildTestServer } from './helpers.js';

const VALID_TOKEN = 'valid-reset-token';
const RESET_TTL_MS = 30 * 60 * 1000;

describe('POST /auth/forgot-password', () => {
  it('rejects a non-object body as VALIDATION_ERROR', async () => {
    const prisma = buildPrisma({});
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: ['nope'],
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('rejects a missing email as VALIDATION_ERROR', async () => {
    const prisma = buildPrisma({});
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: {},
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('rejects a whitespace-only email as VALIDATION_ERROR', async () => {
    const prisma = buildPrisma({});
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email: '   ' },
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('returns { requested: true } without persisting a row for an unknown email', async () => {
    const prisma = buildPrisma({ user: null });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email: 'missing@kody.test' },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.requested).toBe(true);
    expect(body.data.token).toBeUndefined();
    expect(body.data.expiresAt).toBeUndefined();
    expect(prisma.passwordResetToken.updateMany).not.toHaveBeenCalled();
    expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
    expect(prisma.actionLog.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('returns { requested: true } without persisting a row when the user is INACTIVE', async () => {
    const prisma = buildPrisma({
      user: {
        id: 'user_1',
        email: 'inactive@kody.test',
        status: 'INACTIVE',
        lockedUntil: null,
      },
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email: 'inactive@kody.test' },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.requested).toBe(true);
    expect(body.data.token).toBeUndefined();
    expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('persists a hashed reset token for an active user and exposes the raw token once', async () => {
    const prisma = buildPrisma({
      user: {
        id: 'user_1',
        email: 'user@kody.test',
        status: 'ACTIVE',
        lockedUntil: null,
      },
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email: ' USER@kody.test ' },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.requested).toBe(true);
    expect(typeof body.data.token).toBe('string');
    expect(body.data.token.length).toBeGreaterThanOrEqual(64);
    expect(typeof body.data.expiresAt).toBe('string');

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'user@kody.test' },
    });
    expect(prisma.passwordResetToken.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.passwordResetToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user_1', usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
    expect(prisma.passwordResetToken.create).toHaveBeenCalledTimes(1);
    const createArgs = prisma.passwordResetToken.create.mock.calls[0][0];
    expect(createArgs.data.userId).toBe('user_1');
    expect(createArgs.data.tokenHash).toBe(hashPasswordResetToken(body.data.token));
    expect(createArgs.data.tokenHash).not.toBe(body.data.token);
    expect(createArgs.data.usedAt).toBeNull();
    expect(typeof createArgs.data.ipAddress).toBe('string');
    expect(prisma.actionLog.create).not.toHaveBeenCalled();

    await server.close();
  });
});

describe('POST /auth/reset-password/validate', () => {
  it('rejects a non-object body as VALIDATION_ERROR', async () => {
    const server = buildTestServer(buildPrisma({}));
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/auth/reset-password/validate',
      payload: ['nope'],
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');

    await server.close();
  });

  it('rejects a missing/empty token as VALIDATION_ERROR', async () => {
    const server = buildTestServer(buildPrisma({}));
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/auth/reset-password/validate',
      payload: { token: '' },
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');

    await server.close();
  });

  it('returns RESET_TOKEN_INVALID when the token hash matches no row', async () => {
    const prisma = buildPrisma({ resetToken: null });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/auth/reset-password/validate',
      payload: { token: 'unknown' },
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('RESET_TOKEN_INVALID');
    expect(prisma.passwordResetToken.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: hashPasswordResetToken('unknown') },
    });

    await server.close();
  });

  it('returns RESET_TOKEN_USED when the matched token already has a usedAt', async () => {
    const prisma = buildPrisma({
      resetToken: {
        id: 'reset_1',
        userId: 'user_1',
        tokenHash: hashPasswordResetToken(VALID_TOKEN),
        expiresAt: new Date(Date.now() + RESET_TTL_MS),
        usedAt: new Date('2026-05-11T00:00:00.000Z'),
      },
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/auth/reset-password/validate',
      payload: { token: VALID_TOKEN },
    });
    const body = response.json();

    expect(response.statusCode).toBe(410);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('RESET_TOKEN_USED');

    await server.close();
  });

  it('returns RESET_TOKEN_EXPIRED when expiresAt is in the past', async () => {
    const prisma = buildPrisma({
      resetToken: {
        id: 'reset_1',
        userId: 'user_1',
        tokenHash: hashPasswordResetToken(VALID_TOKEN),
        expiresAt: new Date('2020-01-01T00:00:00.000Z'),
        usedAt: null,
      },
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/auth/reset-password/validate',
      payload: { token: VALID_TOKEN },
    });
    const body = response.json();

    expect(response.statusCode).toBe(410);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('RESET_TOKEN_EXPIRED');

    await server.close();
  });

  it('returns only expiresAt for a valid token, never tokenHash or userId', async () => {
    const futureExpiry = new Date(Date.now() + RESET_TTL_MS);
    const prisma = buildPrisma({
      resetToken: {
        id: 'reset_1',
        userId: 'user_1',
        tokenHash: hashPasswordResetToken(VALID_TOKEN),
        expiresAt: futureExpiry,
        usedAt: null,
      },
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/auth/reset-password/validate',
      payload: { token: VALID_TOKEN },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(Object.keys(body.data)).toEqual(['expiresAt']);
    expect(body.data.tokenHash).toBeUndefined();
    expect(body.data.userId).toBeUndefined();

    await server.close();
  });
});

describe('POST /auth/reset-password', () => {
  const activeUser = {
    id: 'user_1',
    email: 'user@kody.test',
    status: 'ACTIVE' as const,
    lockedUntil: null,
  };
  const validToken = {
    id: 'reset_1',
    userId: 'user_1',
    tokenHash: hashPasswordResetToken(VALID_TOKEN),
    expiresAt: new Date(Date.now() + RESET_TTL_MS),
    usedAt: null as Date | null,
  };

  it('rejects a non-object body without calling user.update', async () => {
    const prisma = buildPrisma({});
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: ['nope'],
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();

    await server.close();
  });

  it('rejects missing token / newPassword', async () => {
    const prisma = buildPrisma({});
    const server = buildTestServer(prisma);
    await server.ready();

    const cases: Array<Record<string, unknown>> = [
      { newPassword: 'NewPassword123' },
      { token: VALID_TOKEN },
      { token: '', newPassword: 'NewPassword123' },
      { token: VALID_TOKEN, newPassword: '' },
    ];

    for (const payload of cases) {
      const response = await server.inject({
        method: 'POST',
        url: '/auth/reset-password',
        payload,
      });
      const body = response.json();

      expect(response.statusCode).toBe(400);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    }

    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();

    await server.close();
  });

  it('surfaces RESET_TOKEN_INVALID before any user write', async () => {
    const prisma = buildPrisma({ resetToken: null });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: { token: 'unknown', newPassword: 'NewPassword123' },
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body.error.code).toBe('RESET_TOKEN_INVALID');
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();

    await server.close();
  });

  it('surfaces RESET_TOKEN_USED before any user write', async () => {
    const prisma = buildPrisma({
      resetToken: { ...validToken, usedAt: new Date('2026-05-11T00:00:00.000Z') },
      user: activeUser,
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: { token: VALID_TOKEN, newPassword: 'NewPassword123' },
    });
    const body = response.json();

    expect(response.statusCode).toBe(410);
    expect(body.error.code).toBe('RESET_TOKEN_USED');
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();

    await server.close();
  });

  it('surfaces RESET_TOKEN_EXPIRED before any user write', async () => {
    const prisma = buildPrisma({
      resetToken: { ...validToken, expiresAt: new Date('2020-01-01T00:00:00.000Z') },
      user: activeUser,
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: { token: VALID_TOKEN, newPassword: 'NewPassword123' },
    });
    const body = response.json();

    expect(response.statusCode).toBe(410);
    expect(body.error.code).toBe('RESET_TOKEN_EXPIRED');
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();

    await server.close();
  });

  it('surfaces USER_INACTIVE before any user write when the bound user is INACTIVE', async () => {
    const prisma = buildPrisma({
      resetToken: validToken,
      user: { ...activeUser, status: 'INACTIVE' },
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: { token: VALID_TOKEN, newPassword: 'NewPassword123' },
    });
    const body = response.json();

    expect(response.statusCode).toBe(403);
    expect(body.error.code).toBe('USER_INACTIVE');
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();

    await server.close();
  });

  it('rejects a weak newPassword as PASSWORD_POLICY_FAILED without writing the user', async () => {
    const prisma = buildPrisma({ resetToken: validToken, user: activeUser });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: { token: VALID_TOKEN, newPassword: 'weak' },
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body.error.code).toBe('PASSWORD_POLICY_FAILED');
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();

    await server.close();
  });

  it('updates the user password, marks token usedAt, and revokes refresh tokens in a single transaction', async () => {
    const prisma = buildPrisma({ resetToken: validToken, user: activeUser });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: { token: VALID_TOKEN, newPassword: 'NewPassword123' },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body).toEqual({ ok: true, data: { reset: true } });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user_1' },
      data: {
        passwordHash: expect.any(String),
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    expect(prisma.passwordResetToken.update).toHaveBeenCalledTimes(1);
    expect(prisma.passwordResetToken.update).toHaveBeenCalledWith({
      where: { id: 'reset_1' },
      data: { usedAt: expect.any(Date) },
    });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user_1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(prisma.actionLog.create).not.toHaveBeenCalled();

    await server.close();
  });
});

interface ResetRoutesPrismaSpec {
  user?: {
    id: string;
    email: string;
    status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
    lockedUntil: Date | null;
  } | null;
  resetToken?: {
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    usedAt: Date | null;
  } | null;
}

function buildPrisma(spec: ResetRoutesPrismaSpec) {
  return {
    user: {
      findUnique: vi.fn(async () => spec.user ?? null),
      update: vi.fn(async () => ({})),
    },
    passwordResetToken: {
      findUnique: vi.fn(async () => spec.resetToken ?? null),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
        id: 'reset_new',
        ...args.data,
      })),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    refreshToken: {
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    actionLog: {
      create: vi.fn(async () => ({})),
    },
    $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
  };
}
