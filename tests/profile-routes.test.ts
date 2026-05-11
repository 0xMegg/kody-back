import { describe, expect, it, vi } from 'vitest';
import { buildTestServer } from './helpers.js';
import { hashPassword } from '@/domain/auth/password.js';
import { issueAccessToken } from '@/domain/auth/tokens.js';

describe('profile routes', () => {
  it('returns the current user profile without writing an ActionLog', async () => {
    const user = await buildUser();
    const prisma = buildPrisma(user);
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/profile',
      headers: {
        authorization: `Bearer ${issueToken(user.id)}`,
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data).toEqual({
      id: user.id,
      employeeId: user.employeeId,
      email: user.email,
      displayName: user.displayName,
      status: 'ACTIVE',
      roles: ['SALES'],
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.actionLog.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('updates display name and profile image url without writing an ActionLog', async () => {
    const user = await buildUser();
    const prisma = buildPrisma(user);
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'PATCH',
      url: '/profile',
      headers: {
        authorization: `Bearer ${issueToken(user.id)}`,
      },
      payload: {
        displayName: 'Updated Name',
        profileImageUrl: null,
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.displayName).toBe('Updated Name');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: user.id },
      data: {
        displayName: 'Updated Name',
        profileImageUrl: null,
      },
    });
    expect(prisma.actionLog.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('changes password with a valid current password without writing an ActionLog', async () => {
    const user = await buildUser();
    const prisma = buildPrisma(user);
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/profile/password',
      headers: {
        authorization: `Bearer ${issueToken(user.id)}`,
      },
      payload: {
        currentPassword: 'Password123',
        newPassword: 'NewPassword123',
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body).toEqual({ ok: true, data: { changed: true } });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: user.id },
      data: {
        passwordHash: expect.any(String),
      },
    });
    expect(prisma.actionLog.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('rejects profile update without bearer auth', async () => {
    const server = buildTestServer();
    await server.ready();

    const response = await server.inject({
      method: 'PATCH',
      url: '/profile',
      payload: {
        displayName: 'No Auth',
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(401);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('AUTHENTICATION_ERROR');

    await server.close();
  });

  it('rejects invalid password change body', async () => {
    const user = await buildUser();
    const server = buildTestServer(buildPrisma(user));
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/profile/password',
      headers: {
        authorization: `Bearer ${issueToken(user.id)}`,
      },
      payload: {
        currentPassword: 'Password123',
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');

    await server.close();
  });

  it('rejects password change with invalid current password without writing an ActionLog', async () => {
    const user = await buildUser();
    const prisma = buildPrisma(user);
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/profile/password',
      headers: {
        authorization: `Bearer ${issueToken(user.id)}`,
      },
      payload: {
        currentPassword: 'WrongPassword123',
        newPassword: 'NewPassword123',
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(401);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('INVALID_CURRENT_PASSWORD');
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.actionLog.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('does not write an ActionLog on a no-op profile PATCH with no fields', async () => {
    const user = await buildUser();
    const prisma = buildPrisma(user);
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'PATCH',
      url: '/profile',
      headers: {
        authorization: `Bearer ${issueToken(user.id)}`,
      },
      payload: {},
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data).toEqual({
      id: user.id,
      employeeId: user.employeeId,
      email: user.email,
      displayName: user.displayName,
      status: 'ACTIVE',
      roles: ['SALES'],
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.actionLog.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('rejects password change that fails the password policy without writing an ActionLog', async () => {
    const user = await buildUser();
    const prisma = buildPrisma(user);
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/profile/password',
      headers: {
        authorization: `Bearer ${issueToken(user.id)}`,
      },
      payload: {
        currentPassword: 'Password123',
        newPassword: 'short1',
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('PASSWORD_POLICY_FAILED');
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.actionLog.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('rejects GET /profile without bearer auth', async () => {
    const server = buildTestServer();
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/profile',
    });
    const body = response.json();

    expect(response.statusCode).toBe(401);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('AUTHENTICATION_ERROR');

    await server.close();
  });

  it('rejects POST /profile/password without bearer auth', async () => {
    const user = await buildUser();
    const prisma = buildPrisma(user);
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/profile/password',
      payload: {
        currentPassword: 'Password123',
        newPassword: 'NewPassword123',
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(401);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('AUTHENTICATION_ERROR');
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.actionLog.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('rejects PATCH /profile with non-object body', async () => {
    const user = await buildUser();
    const prisma = buildPrisma(user);
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'PATCH',
      url: '/profile',
      headers: {
        authorization: `Bearer ${issueToken(user.id)}`,
      },
      payload: ['not-an-object'],
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.actionLog.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('rejects PATCH /profile when displayName is not a string', async () => {
    const user = await buildUser();
    const prisma = buildPrisma(user);
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'PATCH',
      url: '/profile',
      headers: {
        authorization: `Bearer ${issueToken(user.id)}`,
      },
      payload: { displayName: 123 },
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.actionLog.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('rejects PATCH /profile when profileImageUrl is not string or null', async () => {
    const user = await buildUser();
    const prisma = buildPrisma(user);
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'PATCH',
      url: '/profile',
      headers: {
        authorization: `Bearer ${issueToken(user.id)}`,
      },
      payload: { profileImageUrl: 123 },
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.actionLog.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('rejects PATCH /profile when displayName is empty after trim', async () => {
    const user = await buildUser();
    const prisma = buildPrisma(user);
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'PATCH',
      url: '/profile',
      headers: {
        authorization: `Bearer ${issueToken(user.id)}`,
      },
      payload: { displayName: '   ' },
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('INVALID_DISPLAY_NAME');
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.actionLog.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('updates only displayName when profileImageUrl is omitted', async () => {
    const user = await buildUser();
    const prisma = buildPrisma(user);
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'PATCH',
      url: '/profile',
      headers: {
        authorization: `Bearer ${issueToken(user.id)}`,
      },
      payload: { displayName: 'Only Name' },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.displayName).toBe('Only Name');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: user.id },
      data: { displayName: 'Only Name' },
    });
    expect(prisma.actionLog.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('updates only profileImageUrl when displayName is omitted', async () => {
    const user = await buildUser();
    const prisma = buildPrisma(user);
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'PATCH',
      url: '/profile',
      headers: {
        authorization: `Bearer ${issueToken(user.id)}`,
      },
      payload: { profileImageUrl: 'https://example.com/a.png' },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: user.id },
      data: { profileImageUrl: 'https://example.com/a.png' },
    });
    expect(prisma.actionLog.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('rejects POST /profile/password when currentPassword is missing', async () => {
    const user = await buildUser();
    const prisma = buildPrisma(user);
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/profile/password',
      headers: {
        authorization: `Bearer ${issueToken(user.id)}`,
      },
      payload: { newPassword: 'NewPassword123' },
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.actionLog.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('rejects PATCH /profile from a suspended actor before any update', async () => {
    const suspended = { ...(await buildUser()), status: 'SUSPENDED' };
    const prisma = buildPrisma(suspended);
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'PATCH',
      url: '/profile',
      headers: {
        authorization: `Bearer ${issueToken(suspended.id)}`,
      },
      payload: { displayName: 'New Name' },
    });
    const body = response.json();

    expect(response.statusCode).toBe(403);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('USER_INACTIVE');
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.actionLog.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('rejects POST /profile/password from a suspended actor before any update', async () => {
    const suspended = { ...(await buildUser()), status: 'SUSPENDED' };
    const prisma = buildPrisma(suspended);
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/profile/password',
      headers: {
        authorization: `Bearer ${issueToken(suspended.id)}`,
      },
      payload: {
        currentPassword: 'Password123',
        newPassword: 'NewPassword123',
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
});

async function buildUser() {
  return {
    id: 'user_1',
    employeeId: 'employee_1',
    email: 'user@kody.test',
    passwordHash: await hashPassword('Password123'),
    displayName: 'KODY User',
    status: 'ACTIVE',
    failedLoginCount: 0,
    lockedUntil: null,
    roles: [{ role: 'SALES' }],
  };
}

function issueToken(userId: string): string {
  return issueAccessToken(
    {
      sub: userId,
      email: 'user@kody.test',
      roles: ['SALES'],
    },
    'test-secret',
  ).token;
}

function buildPrisma(user: Awaited<ReturnType<typeof buildUser>>) {
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
