import { describe, expect, it, vi } from 'vitest';
import { AuthService } from '@/application/auth/auth-service.js';
import { ActionLogWriter } from '@/application/shared/action-log-writer.js';
import { hashPassword } from '@/domain/auth/password.js';
import { hashToken, issueRefreshToken, verifyAccessToken } from '@/domain/auth/tokens.js';
import type { Role, UserStatus } from '@/domain/shared/types.js';

interface MockUser {
  id: string;
  employeeId: string;
  email: string;
  loginId: string;
  passwordHash: string;
  displayName: string;
  status: UserStatus;
  failedLoginCount: number;
  lockedUntil: Date | null;
  roles: { role: Role }[];
}

describe('AuthService', () => {
  const now = new Date('2026-05-06T12:00:00.000Z');

  it('logs in an active user and stores a hashed refresh token', async () => {
    const user = await buildUser();
    const repository = buildRepository(user);
    const service = new AuthService(
      repository,
      new ActionLogWriter(repository.actionLog),
      { jwtSecret: 'test-secret' },
      () => now,
    );

    const result = await service.login({
      loginId: ' ADMIN ',
      password: 'Password123',
      deviceInfo: 'Chrome on macOS',
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
    });

    expect(result.user).toEqual({
      id: user.id,
      employeeId: user.employeeId,
      email: user.email,
      loginId: user.loginId,
      displayName: user.displayName,
      status: 'ACTIVE',
      roles: ['ADMIN', 'FINANCE'],
    });
    expect(result.refreshToken).not.toBe(repository.refreshToken.create.mock.calls[0][0].data.tokenHash);
    expect(repository.user.update).toHaveBeenCalledWith({
      where: { id: user.id },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: now,
      },
    });
    expect(repository.refreshToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: user.id,
        deviceInfo: 'Chrome on macOS',
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
      }),
    });
    expect(repository.actionLog.create).toHaveBeenCalledTimes(1);
    expect(repository.actionLog.create).toHaveBeenCalledWith({
      data: {
        actorUserId: user.id,
        actionType: 'USER_LOGIN',
        targetType: 'User',
        targetId: user.id,
        metadataJson: { deviceInfo: 'Chrome on macOS' },
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
      },
    });

    const payload = verifyAccessToken(result.accessToken, 'test-secret', now);
    expect(payload.sub).toBe(user.id);
    expect(payload.roles).toEqual(['ADMIN', 'FINANCE']);
  });

  it('increments failed login count for an invalid password', async () => {
    const user = await buildUser({ failedLoginCount: 1 });
    const repository = buildRepository(user);
    const service = new AuthService(
      repository,
      new ActionLogWriter(repository.actionLog),
      { jwtSecret: 'test-secret' },
      () => now,
    );

    await expect(
      service.login({ loginId: user.loginId, password: 'WrongPassword123' }),
    ).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
      statusCode: 401,
    });

    expect(repository.user.update).toHaveBeenCalledWith({
      where: { id: user.id },
      data: { failedLoginCount: 2 },
    });
    expect(repository.refreshToken.create).not.toHaveBeenCalled();
    expect(repository.actionLog.create).not.toHaveBeenCalled();
  });

  it('locks the account after five failed login attempts', async () => {
    const user = await buildUser({ failedLoginCount: 4 });
    const repository = buildRepository(user);
    const service = new AuthService(
      repository,
      new ActionLogWriter(repository.actionLog),
      { jwtSecret: 'test-secret' },
      () => now,
    );

    await expect(
      service.login({ loginId: user.loginId, password: 'WrongPassword123' }),
    ).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
      statusCode: 401,
    });

    expect(repository.user.update).toHaveBeenCalledWith({
      where: { id: user.id },
      data: {
        failedLoginCount: 5,
        lockedUntil: new Date('2026-05-06T12:30:00.000Z'),
      },
    });
    expect(repository.actionLog.create).not.toHaveBeenCalled();
  });

  it('rejects inactive users before password verification', async () => {
    const user = await buildUser({ status: 'INACTIVE' });
    const repository = buildRepository(user);
    const service = new AuthService(
      repository,
      new ActionLogWriter(repository.actionLog),
      { jwtSecret: 'test-secret' },
      () => now,
    );

    await expect(
      service.login({ loginId: user.loginId, password: 'Password123' }),
    ).rejects.toMatchObject({
      code: 'USER_INACTIVE',
      statusCode: 403,
    });

    expect(repository.user.update).not.toHaveBeenCalled();
    expect(repository.actionLog.create).not.toHaveBeenCalled();
  });

  it('rejects users whose lockout has not expired', async () => {
    const user = await buildUser({ lockedUntil: new Date('2026-05-06T12:10:00.000Z') });
    const repository = buildRepository(user);
    const service = new AuthService(
      repository,
      new ActionLogWriter(repository.actionLog),
      { jwtSecret: 'test-secret' },
      () => now,
    );

    await expect(
      service.login({ loginId: user.loginId, password: 'Password123' }),
    ).rejects.toMatchObject({
      code: 'ACCOUNT_LOCKED',
      statusCode: 423,
    });

    expect(repository.user.update).not.toHaveBeenCalled();
    expect(repository.actionLog.create).not.toHaveBeenCalled();
  });

  it('refreshes an access token from a stored active refresh token', async () => {
    const user = await buildUser();
    const refreshToken = issueRefreshToken(now);
    const repository = buildRepository(user, {
      id: 'refresh_1',
      userId: user.id,
      tokenHash: refreshToken.tokenHash,
      expiresAt: refreshToken.expiresAt,
      revokedAt: null,
      user,
    });
    const service = new AuthService(
      repository,
      new ActionLogWriter(repository.actionLog),
      { jwtSecret: 'test-secret' },
      () => now,
    );

    const result = await service.refresh(refreshToken.token);

    expect(result.user.email).toBe(user.email);
    expect(result.accessToken).toEqual(expect.any(String));
    expect(verifyAccessToken(result.accessToken, 'test-secret', now).sub).toBe(user.id);
    expect(repository.actionLog.create).not.toHaveBeenCalled();
  });

  it('rejects revoked refresh tokens', async () => {
    const user = await buildUser();
    const repository = buildRepository(user, {
      id: 'refresh_1',
      userId: user.id,
      tokenHash: hashToken('revoked-token'),
      expiresAt: new Date('2026-05-13T12:00:00.000Z'),
      revokedAt: new Date('2026-05-06T12:00:00.000Z'),
      user,
    });
    const service = new AuthService(
      repository,
      new ActionLogWriter(repository.actionLog),
      { jwtSecret: 'test-secret' },
      () => now,
    );

    await expect(service.refresh('revoked-token')).rejects.toMatchObject({
      code: 'INVALID_REFRESH_TOKEN',
      statusCode: 401,
    });
    expect(repository.actionLog.create).not.toHaveBeenCalled();
  });

  it('returns current user from a valid access token', async () => {
    const user = await buildUser();
    const repository = buildRepository(user);
    const service = new AuthService(
      repository,
      new ActionLogWriter(repository.actionLog),
      { jwtSecret: 'test-secret' },
      () => now,
    );
    const accessToken = service['issueAccessTokenForUser'](user).accessToken;

    await expect(service.currentUser(accessToken)).resolves.toEqual({
      id: user.id,
      employeeId: user.employeeId,
      email: user.email,
      loginId: user.loginId,
      displayName: user.displayName,
      status: 'ACTIVE',
      roles: ['ADMIN', 'FINANCE'],
    });
    expect(repository.actionLog.create).not.toHaveBeenCalled();
    expect(repository.user.update).not.toHaveBeenCalled();
  });

  it('revokes a refresh token on logout and writes an action log', async () => {
    const user = await buildUser();
    const repository = buildRepository(user, {
      id: 'refresh_1',
      userId: user.id,
      tokenHash: hashToken('logout-token'),
      expiresAt: new Date('2026-05-13T12:00:00.000Z'),
      revokedAt: null,
      user,
    });
    const service = new AuthService(
      repository,
      new ActionLogWriter(repository.actionLog),
      { jwtSecret: 'test-secret' },
      () => now,
    );

    await expect(service.logout({ refreshToken: 'logout-token' })).resolves.toEqual({
      revoked: true,
    });
    expect(repository.refreshToken.update).toHaveBeenCalledWith({
      where: { id: 'refresh_1' },
      data: { revokedAt: now },
    });
    expect(repository.actionLog.create).toHaveBeenCalledTimes(1);
    expect(repository.actionLog.create).toHaveBeenCalledWith({
      data: {
        actorUserId: user.id,
        actionType: 'USER_LOGOUT',
        targetType: 'User',
        targetId: user.id,
      },
    });
  });

  it('updates the current user profile fields', async () => {
    const user = await buildUser();
    const repository = buildRepository(user);
    const service = new AuthService(
      repository,
      new ActionLogWriter(repository.actionLog),
      { jwtSecret: 'test-secret' },
      () => now,
    );

    await expect(
      service.updateProfile({
        userId: user.id,
        displayName: ' Updated User ',
        profileImageUrl: ' ',
      }),
    ).resolves.toEqual({
      id: user.id,
      employeeId: user.employeeId,
      email: user.email,
      loginId: user.loginId,
      displayName: 'Updated User',
      status: 'ACTIVE',
      roles: ['ADMIN', 'FINANCE'],
    });
    expect(repository.user.update).toHaveBeenCalledWith({
      where: { id: user.id },
      data: {
        displayName: 'Updated User',
        profileImageUrl: null,
      },
    });
    expect(repository.actionLog.create).not.toHaveBeenCalled();
  });

  it('changes password after verifying the current password', async () => {
    const user = await buildUser();
    const repository = buildRepository(user);
    const service = new AuthService(
      repository,
      new ActionLogWriter(repository.actionLog),
      { jwtSecret: 'test-secret' },
      () => now,
    );

    await expect(
      service.changePassword({
        userId: user.id,
        currentPassword: 'Password123',
        newPassword: 'NewPassword123',
      }),
    ).resolves.toEqual({ changed: true });
    expect(repository.user.update).toHaveBeenCalledWith({
      where: { id: user.id },
      data: {
        passwordHash: expect.any(String),
      },
    });
    expect(repository.actionLog.create).not.toHaveBeenCalled();
  });

  it('rejects password change when current password is invalid', async () => {
    const user = await buildUser();
    const repository = buildRepository(user);
    const service = new AuthService(
      repository,
      new ActionLogWriter(repository.actionLog),
      { jwtSecret: 'test-secret' },
      () => now,
    );

    await expect(
      service.changePassword({
        userId: user.id,
        currentPassword: 'WrongPassword123',
        newPassword: 'NewPassword123',
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_CURRENT_PASSWORD',
      statusCode: 401,
    });
    expect(repository.user.update).not.toHaveBeenCalled();
    expect(repository.actionLog.create).not.toHaveBeenCalled();
  });

  it('rejects an expired refresh token when expiresAt is before now', async () => {
    const user = await buildUser();
    const repository = buildRepository(user, {
      id: 'refresh_1',
      userId: user.id,
      tokenHash: hashToken('expired-token'),
      expiresAt: new Date(now.getTime() - 1),
      revokedAt: null,
      user,
    });
    const service = new AuthService(
      repository,
      new ActionLogWriter(repository.actionLog),
      { jwtSecret: 'test-secret' },
      () => now,
    );

    await expect(service.refresh('expired-token')).rejects.toMatchObject({
      code: 'REFRESH_TOKEN_EXPIRED',
      statusCode: 401,
    });

    expect(repository.refreshToken.update).not.toHaveBeenCalled();
    expect(repository.user.update).not.toHaveBeenCalled();
    expect(repository.actionLog.create).not.toHaveBeenCalled();
  });

  it('rejects an expired refresh token at the exact boundary when expiresAt equals now', async () => {
    const user = await buildUser();
    const repository = buildRepository(user, {
      id: 'refresh_1',
      userId: user.id,
      tokenHash: hashToken('boundary-token'),
      expiresAt: new Date(now.getTime()),
      revokedAt: null,
      user,
    });
    const service = new AuthService(
      repository,
      new ActionLogWriter(repository.actionLog),
      { jwtSecret: 'test-secret' },
      () => now,
    );

    await expect(service.refresh('boundary-token')).rejects.toMatchObject({
      code: 'REFRESH_TOKEN_EXPIRED',
      statusCode: 401,
    });

    expect(repository.refreshToken.update).not.toHaveBeenCalled();
    expect(repository.user.update).not.toHaveBeenCalled();
    expect(repository.actionLog.create).not.toHaveBeenCalled();
  });

  it('rejects password change when new password is too short', async () => {
    const user = await buildUser();
    const repository = buildRepository(user);
    const service = new AuthService(
      repository,
      new ActionLogWriter(repository.actionLog),
      { jwtSecret: 'test-secret' },
      () => now,
    );

    await expect(
      service.changePassword({
        userId: user.id,
        currentPassword: 'Password123',
        newPassword: 'Ab1',
      }),
    ).rejects.toMatchObject({
      code: 'PASSWORD_POLICY_FAILED',
      statusCode: 400,
    });

    expect(repository.user.update).not.toHaveBeenCalled();
    expect(repository.actionLog.create).not.toHaveBeenCalled();
  });

  it('rejects password change when new password has no letters', async () => {
    const user = await buildUser();
    const repository = buildRepository(user);
    const service = new AuthService(
      repository,
      new ActionLogWriter(repository.actionLog),
      { jwtSecret: 'test-secret' },
      () => now,
    );

    await expect(
      service.changePassword({
        userId: user.id,
        currentPassword: 'Password123',
        newPassword: '12345678',
      }),
    ).rejects.toMatchObject({
      code: 'PASSWORD_POLICY_FAILED',
      statusCode: 400,
    });

    expect(repository.user.update).not.toHaveBeenCalled();
    expect(repository.actionLog.create).not.toHaveBeenCalled();
  });

  it('rejects password change when new password has no numbers', async () => {
    const user = await buildUser();
    const repository = buildRepository(user);
    const service = new AuthService(
      repository,
      new ActionLogWriter(repository.actionLog),
      { jwtSecret: 'test-secret' },
      () => now,
    );

    await expect(
      service.changePassword({
        userId: user.id,
        currentPassword: 'Password123',
        newPassword: 'AbcdefghIJ',
      }),
    ).rejects.toMatchObject({
      code: 'PASSWORD_POLICY_FAILED',
      statusCode: 400,
    });

    expect(repository.user.update).not.toHaveBeenCalled();
    expect(repository.actionLog.create).not.toHaveBeenCalled();
  });

  it('rejects logout for an unknown refresh token without writing a USER_LOGOUT ActionLog', async () => {
    const user = await buildUser();
    const repository = buildRepository(user);
    const service = new AuthService(
      repository,
      new ActionLogWriter(repository.actionLog),
      { jwtSecret: 'test-secret' },
      () => now,
    );

    await expect(service.logout({ refreshToken: 'unknown-token' })).rejects.toMatchObject({
      code: 'INVALID_REFRESH_TOKEN',
      statusCode: 401,
    });

    expect(repository.refreshToken.update).not.toHaveBeenCalled();
    expect(repository.actionLog.create).not.toHaveBeenCalled();
  });

  it('rejects logout for an already revoked refresh token without writing a USER_LOGOUT ActionLog', async () => {
    const user = await buildUser();
    const repository = buildRepository(user, {
      id: 'refresh_1',
      userId: user.id,
      tokenHash: hashToken('revoked-logout-token'),
      expiresAt: new Date('2026-05-13T12:00:00.000Z'),
      revokedAt: new Date('2026-05-06T11:00:00.000Z'),
      user,
    });
    const service = new AuthService(
      repository,
      new ActionLogWriter(repository.actionLog),
      { jwtSecret: 'test-secret' },
      () => now,
    );

    await expect(
      service.logout({ refreshToken: 'revoked-logout-token' }),
    ).rejects.toMatchObject({
      code: 'INVALID_REFRESH_TOKEN',
      statusCode: 401,
    });

    expect(repository.refreshToken.update).not.toHaveBeenCalled();
    expect(repository.actionLog.create).not.toHaveBeenCalled();
  });
});

async function buildUser(overrides: Partial<MockUser> = {}): Promise<MockUser> {
  return {
    id: 'user_1',
    employeeId: 'employee_1',
    email: 'admin@kody.test',
    loginId: 'admin',
    passwordHash: await hashPassword('Password123'),
    displayName: 'KODY Admin',
    status: 'ACTIVE',
    failedLoginCount: 0,
    lockedUntil: null,
    roles: [{ role: 'ADMIN' }, { role: 'FINANCE' }],
    ...overrides,
  };
}

function buildRepository(
  user: MockUser | null,
  refreshToken: {
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    revokedAt: Date | null;
    user: MockUser;
  } | null = null,
) {
  return {
    user: {
      findUnique: vi.fn(async () => user),
      update: vi.fn(async () => ({})),
    },
    refreshToken: {
      findUnique: vi.fn(async (args: { where: { tokenHash: string } }) =>
        refreshToken?.tokenHash === args.where.tokenHash ? refreshToken : null,
      ),
      create: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
    },
    actionLog: {
      create: vi.fn(async () => ({})),
    },
  };
}
