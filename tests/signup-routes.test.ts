import { describe, expect, it, vi } from 'vitest';
import { hashInviteToken } from '@/domain/auth/tokens.js';
import { buildTestServer } from './helpers.js';
import type { Role } from '@/domain/shared/types.js';

const VALID_TOKEN = 'valid-invite-token';
const EXPIRES_AT = new Date('2027-01-01T00:00:00.000Z');

describe('POST /auth/invite/validate', () => {
  it('rejects a non-object body', async () => {
    const server = buildTestServer(buildPrisma({}));
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/auth/invite/validate',
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
      url: '/auth/invite/validate',
      payload: { token: '' },
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');

    await server.close();
  });

  it('returns INVITE_TOKEN_INVALID when the token hash does not match any row', async () => {
    const prisma = buildPrisma({ invite: null });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/auth/invite/validate',
      payload: { token: 'unknown-token' },
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('INVITE_TOKEN_INVALID');
    expect(prisma.inviteToken.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: hashInviteToken('unknown-token') },
      include: { roles: { select: { role: true } } },
    });
    expect(prisma.actionLog.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('returns INVITE_TOKEN_USED when the invite has been consumed', async () => {
    const prisma = buildPrisma({
      invite: {
        id: 'invite_1',
        email: 'invitee@kody.test',
        tokenHash: hashInviteToken(VALID_TOKEN),
        invitedByUserId: 'admin_1',
        expiresAt: EXPIRES_AT,
        usedAt: new Date('2026-05-10T00:00:00.000Z'),
      },
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/auth/invite/validate',
      payload: { token: VALID_TOKEN },
    });
    const body = response.json();

    expect(response.statusCode).toBe(410);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('INVITE_TOKEN_USED');
    expect(prisma.actionLog.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('returns INVITE_TOKEN_EXPIRED when expiresAt is in the past', async () => {
    const prisma = buildPrisma({
      invite: {
        id: 'invite_1',
        email: 'invitee@kody.test',
        tokenHash: hashInviteToken(VALID_TOKEN),
        invitedByUserId: 'admin_1',
        expiresAt: new Date('2020-01-01T00:00:00.000Z'),
        usedAt: null,
      },
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/auth/invite/validate',
      payload: { token: VALID_TOKEN },
    });
    const body = response.json();

    expect(response.statusCode).toBe(410);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('INVITE_TOKEN_EXPIRED');
    expect(prisma.actionLog.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('returns only email and expiresAt for a valid token, never tokenHash or invitedByUserId', async () => {
    const prisma = buildPrisma({
      invite: {
        id: 'invite_1',
        email: 'invitee@kody.test',
        tokenHash: hashInviteToken(VALID_TOKEN),
        invitedByUserId: 'admin_1',
        expiresAt: EXPIRES_AT,
        usedAt: null,
      },
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/auth/invite/validate',
      payload: { token: VALID_TOKEN },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(Object.keys(body.data).sort()).toEqual(['email', 'expiresAt', 'roles']);
    expect(body.data.email).toBe('invitee@kody.test');
    expect(body.data.roles).toEqual(['SALES']);
    expect(body.data.tokenHash).toBeUndefined();
    expect(body.data.invitedByUserId).toBeUndefined();
    expect(prisma.actionLog.create).not.toHaveBeenCalled();

    await server.close();
  });
});

describe('POST /auth/signup', () => {
  const validInvite = {
    id: 'invite_1',
    email: 'invitee@kody.test',
    tokenHash: hashInviteToken(VALID_TOKEN),
    invitedByUserId: 'admin_1',
    expiresAt: EXPIRES_AT,
    usedAt: null as Date | null,
    roles: [{ role: 'SALES' as Role }],
  };
  const activeEmployee = {
    id: 'employee_1',
    email: 'invitee@kody.test',
    status: 'ACTIVE' as const,
  };

  it('rejects a non-object body without calling user.create', async () => {
    const prisma = buildPrisma({});
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: ['nope'],
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();

    await server.close();
  });

  it('rejects missing token / password / displayName', async () => {
    const prisma = buildPrisma({});
    const server = buildTestServer(prisma);
    await server.ready();

    const cases: Array<Record<string, unknown>> = [
      { password: 'Password123', displayName: 'A' },
      { token: VALID_TOKEN, displayName: 'A' },
      { token: VALID_TOKEN, password: 'Password123' },
    ];

    for (const payload of cases) {
      const response = await server.inject({
        method: 'POST',
        url: '/auth/signup',
        payload,
      });
      const body = response.json();

      expect(response.statusCode).toBe(400);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    }

    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();

    await server.close();
  });

  it('surfaces INVITE_TOKEN_INVALID before any user write', async () => {
    const prisma = buildPrisma({ invite: null });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { token: 'unknown', loginId: 'new.user', password: 'Password123', displayName: 'New User' },
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body.error.code).toBe('INVITE_TOKEN_INVALID');
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();

    await server.close();
  });

  it('surfaces INVITE_TOKEN_USED before any user write', async () => {
    const prisma = buildPrisma({
      invite: { ...validInvite, usedAt: new Date('2026-05-10T00:00:00.000Z') },
      employee: activeEmployee,
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { token: VALID_TOKEN, loginId: 'new.user', password: 'Password123', displayName: 'New User' },
    });
    const body = response.json();

    expect(response.statusCode).toBe(410);
    expect(body.error.code).toBe('INVITE_TOKEN_USED');
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();

    await server.close();
  });

  it('surfaces INVITE_TOKEN_EXPIRED before any user write', async () => {
    const prisma = buildPrisma({
      invite: { ...validInvite, expiresAt: new Date('2020-01-01T00:00:00.000Z') },
      employee: activeEmployee,
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { token: VALID_TOKEN, loginId: 'new.user', password: 'Password123', displayName: 'New User' },
    });
    const body = response.json();

    expect(response.statusCode).toBe(410);
    expect(body.error.code).toBe('INVITE_TOKEN_EXPIRED');
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();

    await server.close();
  });

  it('surfaces EMPLOYEE_NOT_FOUND before any user write', async () => {
    const prisma = buildPrisma({ invite: validInvite, employee: null });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { token: VALID_TOKEN, loginId: 'new.user', password: 'Password123', displayName: 'New User' },
    });
    const body = response.json();

    expect(response.statusCode).toBe(404);
    expect(body.error.code).toBe('EMPLOYEE_NOT_FOUND');
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();

    await server.close();
  });

  it('surfaces EMPLOYEE_INACTIVE before any user write', async () => {
    const prisma = buildPrisma({
      invite: validInvite,
      employee: { ...activeEmployee, status: 'INACTIVE' },
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { token: VALID_TOKEN, loginId: 'new.user', password: 'Password123', displayName: 'New User' },
    });
    const body = response.json();

    expect(response.statusCode).toBe(403);
    expect(body.error.code).toBe('EMPLOYEE_INACTIVE');
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();

    await server.close();
  });

  it('surfaces USER_ALREADY_EXISTS before any user write', async () => {
    const prisma = buildPrisma({
      invite: validInvite,
      employee: activeEmployee,
      existingUser: { id: 'user_existing', employeeId: 'employee_1', email: 'invitee@kody.test', loginId: 'existing' },
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { token: VALID_TOKEN, loginId: 'new.user', password: 'Password123', displayName: 'New User' },
    });
    const body = response.json();

    expect(response.statusCode).toBe(409);
    expect(body.error.code).toBe('USER_ALREADY_EXISTS');
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();

    await server.close();
  });

  it('rejects a weak password as PASSWORD_POLICY_FAILED without writing a user', async () => {
    const prisma = buildPrisma({ invite: validInvite, employee: activeEmployee });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { token: VALID_TOKEN, loginId: 'new.user', password: 'weak', displayName: 'New User' },
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body.error.code).toBe('PASSWORD_POLICY_FAILED');
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();

    await server.close();
  });

  it('rejects whitespace-only displayName as INVALID_DISPLAY_NAME without writing a user', async () => {
    const prisma = buildPrisma({ invite: validInvite, employee: activeEmployee });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { token: VALID_TOKEN, loginId: 'new.user', password: 'Password123', displayName: '   ' },
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body.error.code).toBe('INVALID_DISPLAY_NAME');
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();

    await server.close();
  });

  it('creates User, UserRole rows, and sets invite usedAt in a single transaction', async () => {
    const prisma = buildPrisma({ invite: validInvite, employee: activeEmployee });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { token: VALID_TOKEN, loginId: 'new.user', password: 'Password123', displayName: '  Trimmed Name  ' },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data).toEqual({
      user: {
        id: 'user_new',
        employeeId: 'employee_1',
        email: 'invitee@kody.test',
        loginId: 'new.user',
        displayName: 'Trimmed Name',
        status: 'ACTIVE',
        roles: ['SALES'],
      },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.user.create).toHaveBeenCalledTimes(1);
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        employeeId: 'employee_1',
        email: 'invitee@kody.test',
        loginId: 'new.user',
        passwordHash: expect.any(String),
        displayName: 'Trimmed Name',
        status: 'ACTIVE',
      },
    });
    expect(prisma.inviteToken.update).toHaveBeenCalledTimes(1);
    expect(prisma.inviteToken.update).toHaveBeenCalledWith({
      where: { id: 'invite_1' },
      data: { usedAt: expect.any(Date) },
    });
    expect(prisma.userRole.createMany).toHaveBeenCalledWith({
      data: [{ userId: 'user_new', role: 'SALES' }],
      skipDuplicates: true,
    });
    expect(prisma.actionLog.create).not.toHaveBeenCalled();

    await server.close();
  });
});

interface SignupPrismaSpec {
  invite?: {
    id: string;
    email: string;
    tokenHash: string;
    invitedByUserId: string;
    expiresAt: Date;
    usedAt: Date | null;
    roles?: Array<{ role: Role }>;
  } | null;
  employee?: { id: string; email: string; status: 'ACTIVE' | 'INACTIVE' } | null;
  existingUser?: { id: string; employeeId: string; email: string; loginId?: string } | null;
}

function buildPrisma(spec: SignupPrismaSpec) {
  const prisma = {
    user: {
      findFirst: vi.fn(async () => spec.existingUser ?? null),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
        id: 'user_new',
        ...args.data,
      })),
    },
    employee: {
      findUnique: vi.fn(async () => spec.employee ?? null),
    },
    inviteToken: {
      findUnique: vi.fn(async () =>
        spec.invite ? { ...spec.invite, roles: spec.invite.roles ?? [{ role: 'SALES' as Role }] } : null,
      ),
      findFirst: vi.fn(async () => null),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
        id: 'invite_new',
        ...args.data,
      })),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    userRole: {
      createMany: vi.fn(async () => ({ count: 1 })),
    },
    actionLog: {
      create: vi.fn(async () => ({})),
    },
    $transaction: vi.fn(async (operation: Promise<unknown>[] | ((tx: unknown) => Promise<unknown>)) =>
      typeof operation === 'function' ? operation(prisma) : Promise.all(operation),
    ),
  };
  return prisma;
}
