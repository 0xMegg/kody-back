import { describe, expect, it, vi } from 'vitest';
import { PasswordResetService } from '@/application/auth/password-reset-service.js';
import {
  hashInviteToken,
  hashPasswordResetToken,
  hashToken,
} from '@/domain/auth/tokens.js';

const FIXED_NOW = new Date('2026-05-12T00:00:00.000Z');
const RESET_TTL_MS = 30 * 60 * 1000;
const EXPECTED_EXPIRES_AT = new Date(FIXED_NOW.getTime() + RESET_TTL_MS);

describe('hashPasswordResetToken', () => {
  it('returns a deterministic base64url string for the same input', () => {
    const first = hashPasswordResetToken('reset-token-abc');
    const second = hashPasswordResetToken('reset-token-abc');

    expect(first).toEqual(second);
    expect(first).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(first.length).toBeGreaterThan(0);
  });

  it('uses a distinct HMAC key from hashToken so refresh and reset hash spaces do not collide', () => {
    expect(hashPasswordResetToken('same-token')).not.toEqual(hashToken('same-token'));
  });

  it('uses a distinct HMAC key from hashInviteToken so invite and reset hash spaces do not collide', () => {
    expect(hashPasswordResetToken('same-token')).not.toEqual(hashInviteToken('same-token'));
  });

  it('produces a different digest for different inputs', () => {
    expect(hashPasswordResetToken('a')).not.toEqual(hashPasswordResetToken('b'));
  });
});

describe('PasswordResetService.requestReset', () => {
  it('returns { requested: true } without a token when no user matches the email and does not write any row', async () => {
    const prisma = buildResetPrisma({ user: null });
    const service = new PasswordResetService(prisma as never, () => FIXED_NOW);

    const result = await service.requestReset({ email: 'missing@kody.test' });

    expect(result).toEqual({ requested: true });
    expect(prisma.passwordResetToken.updateMany).not.toHaveBeenCalled();
    expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
  });

  it('returns { requested: true } without a token when the user is INACTIVE and does not write any row', async () => {
    const prisma = buildResetPrisma({
      user: {
        id: 'user_1',
        email: 'inactive@kody.test',
        status: 'INACTIVE',
        lockedUntil: null,
      },
    });
    const service = new PasswordResetService(prisma as never, () => FIXED_NOW);

    const result = await service.requestReset({ email: 'inactive@kody.test' });

    expect(result).toEqual({ requested: true });
    expect(prisma.passwordResetToken.updateMany).not.toHaveBeenCalled();
    expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
  });

  it('returns { requested: true } without a token when the user is currently locked and does not write any row', async () => {
    const prisma = buildResetPrisma({
      user: {
        id: 'user_1',
        email: 'locked@kody.test',
        status: 'ACTIVE',
        lockedUntil: new Date(FIXED_NOW.getTime() + 60 * 1000),
      },
    });
    const service = new PasswordResetService(prisma as never, () => FIXED_NOW);

    const result = await service.requestReset({ email: 'locked@kody.test' });

    expect(result).toEqual({ requested: true });
    expect(prisma.passwordResetToken.updateMany).not.toHaveBeenCalled();
    expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
  });

  it('invalidates prior unused tokens via updateMany then creates a fresh row with a hashed token and 30m expiry', async () => {
    const callOrder: string[] = [];
    const prisma = buildResetPrisma({
      user: {
        id: 'user_1',
        email: 'user@kody.test',
        status: 'ACTIVE',
        lockedUntil: null,
      },
    });
    prisma.passwordResetToken.updateMany.mockImplementation(async () => {
      callOrder.push('updateMany');
      return { count: 1 };
    });
    prisma.passwordResetToken.create.mockImplementation(
      async (args: { data: Record<string, unknown> }) => {
        callOrder.push('create');
        return {
          id: 'reset_1',
          userId: args.data.userId as string,
          tokenHash: args.data.tokenHash as string,
          expiresAt: args.data.expiresAt as Date,
          usedAt: null,
        };
      },
    );

    const service = new PasswordResetService(prisma as never, () => FIXED_NOW);
    const result = await service.requestReset({
      email: ' USER@kody.test ',
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
    });

    expect(callOrder).toEqual(['updateMany', 'create']);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'user@kody.test' },
    });
    expect(prisma.passwordResetToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user_1', usedAt: null },
      data: { usedAt: FIXED_NOW },
    });
    expect(prisma.passwordResetToken.create).toHaveBeenCalledTimes(1);
    expect(result.requested).toBe(true);
    expect(typeof result.token).toBe('string');
    expect(result.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect((result.token as string).length).toBeGreaterThanOrEqual(64);
    expect(result.expiresAt).toEqual(EXPECTED_EXPIRES_AT);

    const createArgs = prisma.passwordResetToken.create.mock.calls[0][0];
    expect(createArgs.data).toEqual({
      userId: 'user_1',
      tokenHash: hashPasswordResetToken(result.token as string),
      expiresAt: EXPECTED_EXPIRES_AT,
      usedAt: null,
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
    });
    expect(createArgs.data.tokenHash).not.toEqual(result.token);
  });

  it('omits ipAddress and userAgent from create when they are not provided', async () => {
    const prisma = buildResetPrisma({
      user: {
        id: 'user_1',
        email: 'user@kody.test',
        status: 'ACTIVE',
        lockedUntil: null,
      },
    });
    const service = new PasswordResetService(prisma as never, () => FIXED_NOW);

    await service.requestReset({ email: 'user@kody.test' });

    const createArgs = prisma.passwordResetToken.create.mock.calls[0][0];
    expect(createArgs.data.ipAddress).toBeUndefined();
    expect(createArgs.data.userAgent).toBeUndefined();
  });
});

describe('PasswordResetService.validateReset', () => {
  it('throws RESET_TOKEN_INVALID when no token row matches the hash', async () => {
    const prisma = buildResetPrisma({ tokenByHash: null });
    const service = new PasswordResetService(prisma as never, () => FIXED_NOW);

    await expect(service.validateReset('unknown-token')).rejects.toMatchObject({
      code: 'RESET_TOKEN_INVALID',
      statusCode: 400,
    });
    expect(prisma.passwordResetToken.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: hashPasswordResetToken('unknown-token') },
    });
  });

  it('throws RESET_TOKEN_USED when the matched token already has a usedAt', async () => {
    const prisma = buildResetPrisma({
      tokenByHash: {
        id: 'reset_1',
        userId: 'user_1',
        tokenHash: hashPasswordResetToken('used-token'),
        expiresAt: EXPECTED_EXPIRES_AT,
        usedAt: new Date('2026-05-11T00:00:00.000Z'),
      },
    });
    const service = new PasswordResetService(prisma as never, () => FIXED_NOW);

    await expect(service.validateReset('used-token')).rejects.toMatchObject({
      code: 'RESET_TOKEN_USED',
      statusCode: 410,
    });
  });

  it('throws RESET_TOKEN_EXPIRED when expiresAt is exactly equal to now', async () => {
    const prisma = buildResetPrisma({
      tokenByHash: {
        id: 'reset_1',
        userId: 'user_1',
        tokenHash: hashPasswordResetToken('expired-token'),
        expiresAt: FIXED_NOW,
        usedAt: null,
      },
    });
    const service = new PasswordResetService(prisma as never, () => FIXED_NOW);

    await expect(service.validateReset('expired-token')).rejects.toMatchObject({
      code: 'RESET_TOKEN_EXPIRED',
      statusCode: 410,
    });
  });

  it('throws RESET_TOKEN_EXPIRED when expiresAt is one millisecond before now', async () => {
    const prisma = buildResetPrisma({
      tokenByHash: {
        id: 'reset_1',
        userId: 'user_1',
        tokenHash: hashPasswordResetToken('expired-token'),
        expiresAt: new Date(FIXED_NOW.getTime() - 1),
        usedAt: null,
      },
    });
    const service = new PasswordResetService(prisma as never, () => FIXED_NOW);

    await expect(service.validateReset('expired-token')).rejects.toMatchObject({
      code: 'RESET_TOKEN_EXPIRED',
      statusCode: 410,
    });
  });

  it('returns { expiresAt } only on a valid token', async () => {
    const prisma = buildResetPrisma({
      tokenByHash: {
        id: 'reset_1',
        userId: 'user_1',
        tokenHash: hashPasswordResetToken('valid-token'),
        expiresAt: EXPECTED_EXPIRES_AT,
        usedAt: null,
      },
    });
    const service = new PasswordResetService(prisma as never, () => FIXED_NOW);

    const result = await service.validateReset('valid-token');

    expect(result).toEqual({ expiresAt: EXPECTED_EXPIRES_AT });
    expect(Object.keys(result)).toEqual(['expiresAt']);
  });
});

describe('PasswordResetService.consumeReset', () => {
  const validToken = {
    id: 'reset_1',
    userId: 'user_1',
    tokenHash: hashPasswordResetToken('valid-token'),
    expiresAt: EXPECTED_EXPIRES_AT,
    usedAt: null as Date | null,
  };
  const activeUser = {
    id: 'user_1',
    email: 'user@kody.test',
    status: 'ACTIVE' as const,
    lockedUntil: null,
  };

  it('throws RESET_TOKEN_INVALID before any user write when no token row matches', async () => {
    const prisma = buildResetPrisma({ tokenByHash: null, user: activeUser });
    const service = new PasswordResetService(prisma as never, () => FIXED_NOW);

    await expect(
      service.consumeReset({ token: 'unknown', newPassword: 'NewPassword123' }),
    ).rejects.toMatchObject({ code: 'RESET_TOKEN_INVALID', statusCode: 400 });
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.passwordResetToken.update).not.toHaveBeenCalled();
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('throws RESET_TOKEN_USED before any user write when the token is consumed', async () => {
    const prisma = buildResetPrisma({
      tokenByHash: { ...validToken, usedAt: new Date('2026-05-11T00:00:00.000Z') },
      user: activeUser,
    });
    const service = new PasswordResetService(prisma as never, () => FIXED_NOW);

    await expect(
      service.consumeReset({ token: 'valid-token', newPassword: 'NewPassword123' }),
    ).rejects.toMatchObject({ code: 'RESET_TOKEN_USED', statusCode: 410 });
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('throws RESET_TOKEN_EXPIRED before any user write when the token is past expiry', async () => {
    const prisma = buildResetPrisma({
      tokenByHash: { ...validToken, expiresAt: new Date(FIXED_NOW.getTime() - 1) },
      user: activeUser,
    });
    const service = new PasswordResetService(prisma as never, () => FIXED_NOW);

    await expect(
      service.consumeReset({ token: 'valid-token', newPassword: 'NewPassword123' }),
    ).rejects.toMatchObject({ code: 'RESET_TOKEN_EXPIRED', statusCode: 410 });
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('throws RESET_TOKEN_INVALID before any user write when the token-bound user is missing', async () => {
    const prisma = buildResetPrisma({ tokenByHash: validToken, user: null });
    const service = new PasswordResetService(prisma as never, () => FIXED_NOW);

    await expect(
      service.consumeReset({ token: 'valid-token', newPassword: 'NewPassword123' }),
    ).rejects.toMatchObject({ code: 'RESET_TOKEN_INVALID', statusCode: 400 });
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('throws USER_INACTIVE before any user write when the token-bound user is INACTIVE', async () => {
    const prisma = buildResetPrisma({
      tokenByHash: validToken,
      user: { ...activeUser, status: 'INACTIVE' },
    });
    const service = new PasswordResetService(prisma as never, () => FIXED_NOW);

    await expect(
      service.consumeReset({ token: 'valid-token', newPassword: 'NewPassword123' }),
    ).rejects.toMatchObject({ code: 'USER_INACTIVE', statusCode: 403 });
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('throws PASSWORD_POLICY_FAILED for a weak password without writing any row', async () => {
    const prisma = buildResetPrisma({ tokenByHash: validToken, user: activeUser });
    const service = new PasswordResetService(prisma as never, () => FIXED_NOW);

    await expect(
      service.consumeReset({ token: 'valid-token', newPassword: 'weak' }),
    ).rejects.toMatchObject({ code: 'PASSWORD_POLICY_FAILED', statusCode: 400 });
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('runs user.update, passwordResetToken.update, and refreshToken.updateMany in a single $transaction and returns { reset: true }', async () => {
    const prisma = buildResetPrisma({ tokenByHash: validToken, user: activeUser });
    const service = new PasswordResetService(prisma as never, () => FIXED_NOW);

    const result = await service.consumeReset({
      token: 'valid-token',
      newPassword: 'NewPassword123',
    });

    expect(result).toEqual({ reset: true });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);

    const transactionArgs = prisma.$transaction.mock.calls[0]?.[0];
    expect(Array.isArray(transactionArgs)).toBe(true);
    expect(transactionArgs).toHaveLength(3);

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
      data: { usedAt: FIXED_NOW },
    });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user_1', revokedAt: null },
      data: { revokedAt: FIXED_NOW },
    });
    expect(prisma.actionLog.create).not.toHaveBeenCalled();
  });
});

interface ResetPrismaSpec {
  user?: {
    id: string;
    email: string;
    status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
    lockedUntil: Date | null;
  } | null;
  tokenByHash?: {
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    usedAt: Date | null;
  } | null;
}

function buildResetPrisma(spec: ResetPrismaSpec) {
  return {
    user: {
      findUnique: vi.fn(async () => spec.user ?? null),
      update: vi.fn(async () => ({})),
    },
    passwordResetToken: {
      findUnique: vi.fn(async () => spec.tokenByHash ?? null),
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
