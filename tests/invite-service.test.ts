import { describe, expect, it, vi } from 'vitest';
import { InviteService } from '@/application/auth/invite-service.js';
import { hashInviteToken, hashToken } from '@/domain/auth/tokens.js';

const FIXED_NOW = new Date('2026-05-11T00:00:00.000Z');
const EXPECTED_EXPIRES_AT = new Date(FIXED_NOW.getTime() + 72 * 60 * 60 * 1000);

describe('hashInviteToken', () => {
  it('returns a deterministic base64url string for the same input', () => {
    const first = hashInviteToken('invite-token-abc');
    const second = hashInviteToken('invite-token-abc');

    expect(first).toEqual(second);
    expect(first).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(first.length).toBeGreaterThan(0);
  });

  it('uses a distinct HMAC key from hashToken so refresh and invite hash spaces do not collide', () => {
    expect(hashInviteToken('same-token')).not.toEqual(hashToken('same-token'));
  });

  it('produces a different digest for different inputs', () => {
    expect(hashInviteToken('a')).not.toEqual(hashInviteToken('b'));
  });
});

describe('InviteService.createInvite', () => {
  it('throws EMPLOYEE_NOT_FOUND when no employee exists for the email and does not persist a token', async () => {
    const prisma = buildInvitePrisma({ employee: null });
    const service = new InviteService(prisma as never, () => FIXED_NOW);

    await expect(
      service.createInvite({
        actorUserId: 'admin_1',
        email: 'no-one@kody.test',
      }),
    ).rejects.toMatchObject({ code: 'EMPLOYEE_NOT_FOUND', statusCode: 404 });
    expect(prisma.inviteToken.create).not.toHaveBeenCalled();
  });

  it('throws EMPLOYEE_INACTIVE when the employee row is INACTIVE and does not persist a token', async () => {
    const prisma = buildInvitePrisma({
      employee: { id: 'employee_1', email: 'inactive@kody.test', status: 'INACTIVE' },
    });
    const service = new InviteService(prisma as never, () => FIXED_NOW);

    await expect(
      service.createInvite({
        actorUserId: 'admin_1',
        email: 'inactive@kody.test',
      }),
    ).rejects.toMatchObject({ code: 'EMPLOYEE_INACTIVE', statusCode: 403 });
    expect(prisma.inviteToken.create).not.toHaveBeenCalled();
  });

  it('throws USER_ALREADY_EXISTS when a user row already exists for the employee and does not persist a token', async () => {
    const prisma = buildInvitePrisma({
      employee: { id: 'employee_1', email: 'taken@kody.test', status: 'ACTIVE' },
      existingUser: { id: 'user_1', employeeId: 'employee_1', email: 'taken@kody.test' },
    });
    const service = new InviteService(prisma as never, () => FIXED_NOW);

    await expect(
      service.createInvite({
        actorUserId: 'admin_1',
        email: 'taken@kody.test',
      }),
    ).rejects.toMatchObject({ code: 'USER_ALREADY_EXISTS', statusCode: 409 });
    expect(prisma.inviteToken.create).not.toHaveBeenCalled();
  });

  it('creates an invite token row with normalized email, hashed token, 72h expiry, and returns the raw token once', async () => {
    const prisma = buildInvitePrisma({
      employee: { id: 'employee_1', email: 'invitee@kody.test', status: 'ACTIVE' },
      createReturn: { id: 'invite_1' },
    });
    const service = new InviteService(prisma as never, () => FIXED_NOW);

    const result = await service.createInvite({
      actorUserId: 'admin_1',
      email: ' INVITEE@kody.test ',
    });

    expect(result.email).toBe('invitee@kody.test');
    expect(result.id).toBe('invite_1');
    expect(result.expiresAt.getTime() - FIXED_NOW.getTime()).toBe(72 * 60 * 60 * 1000);
    expect(result.expiresAt).toEqual(EXPECTED_EXPIRES_AT);
    expect(typeof result.token).toBe('string');
    expect(result.token.length).toBeGreaterThanOrEqual(64);
    expect(result.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(prisma.inviteToken.create).toHaveBeenCalledTimes(1);
    expect(prisma.inviteToken.create).toHaveBeenCalledWith({
      data: {
        email: 'invitee@kody.test',
        tokenHash: hashInviteToken(result.token),
        invitedByUserId: 'admin_1',
        expiresAt: EXPECTED_EXPIRES_AT,
        usedAt: null,
      },
    });
  });
});

describe('InviteService.resendInvite', () => {
  it('throws EMPLOYEE_NOT_FOUND when no employee exists for the email and does not touch invite rows', async () => {
    const prisma = buildInvitePrisma({ employee: null });
    const service = new InviteService(prisma as never, () => FIXED_NOW);

    await expect(
      service.resendInvite({ actorUserId: 'admin_1', email: 'missing@kody.test' }),
    ).rejects.toMatchObject({ code: 'EMPLOYEE_NOT_FOUND', statusCode: 404 });
    expect(prisma.inviteToken.updateMany).not.toHaveBeenCalled();
    expect(prisma.inviteToken.create).not.toHaveBeenCalled();
  });

  it('throws EMPLOYEE_INACTIVE when the employee row is INACTIVE and does not touch invite rows', async () => {
    const prisma = buildInvitePrisma({
      employee: { id: 'employee_1', email: 'inactive@kody.test', status: 'INACTIVE' },
      priorInvites: [{ id: 'invite_prior', email: 'inactive@kody.test', usedAt: null }],
    });
    const service = new InviteService(prisma as never, () => FIXED_NOW);

    await expect(
      service.resendInvite({ actorUserId: 'admin_1', email: 'inactive@kody.test' }),
    ).rejects.toMatchObject({ code: 'EMPLOYEE_INACTIVE', statusCode: 403 });
    expect(prisma.inviteToken.updateMany).not.toHaveBeenCalled();
    expect(prisma.inviteToken.create).not.toHaveBeenCalled();
  });

  it('throws USER_ALREADY_EXISTS when a user already exists for the employee and does not touch invite rows', async () => {
    const prisma = buildInvitePrisma({
      employee: { id: 'employee_1', email: 'taken@kody.test', status: 'ACTIVE' },
      existingUser: { id: 'user_1', employeeId: 'employee_1', email: 'taken@kody.test' },
      priorInvites: [{ id: 'invite_prior', email: 'taken@kody.test', usedAt: null }],
    });
    const service = new InviteService(prisma as never, () => FIXED_NOW);

    await expect(
      service.resendInvite({ actorUserId: 'admin_1', email: 'taken@kody.test' }),
    ).rejects.toMatchObject({ code: 'USER_ALREADY_EXISTS', statusCode: 409 });
    expect(prisma.inviteToken.updateMany).not.toHaveBeenCalled();
    expect(prisma.inviteToken.create).not.toHaveBeenCalled();
  });

  it('throws INVITE_NOT_FOUND when no prior unused invite exists for the email and does not write any row', async () => {
    const prisma = buildInvitePrisma({
      employee: { id: 'employee_1', email: 'invitee@kody.test', status: 'ACTIVE' },
      priorInvites: [],
    });
    const service = new InviteService(prisma as never, () => FIXED_NOW);

    await expect(
      service.resendInvite({ actorUserId: 'admin_1', email: 'invitee@kody.test' }),
    ).rejects.toMatchObject({ code: 'INVITE_NOT_FOUND', statusCode: 404 });
    expect(prisma.inviteToken.updateMany).not.toHaveBeenCalled();
    expect(prisma.inviteToken.create).not.toHaveBeenCalled();
  });

  it('invalidates prior unused invites via updateMany then creates a fresh row with 72h expiry', async () => {
    const callOrder: string[] = [];
    const prisma = buildInvitePrisma({
      employee: { id: 'employee_1', email: 'invitee@kody.test', status: 'ACTIVE' },
      priorInvites: [{ id: 'invite_prior', email: 'invitee@kody.test', usedAt: null }],
      createReturn: { id: 'invite_2' },
    });
    prisma.inviteToken.updateMany.mockImplementation(async () => {
      callOrder.push('updateMany');
      return { count: 1 };
    });
    prisma.inviteToken.create.mockImplementation(async (args: { data: Record<string, unknown> }) => {
      callOrder.push('create');
      return { id: 'invite_2', ...args.data };
    });

    const service = new InviteService(prisma as never, () => FIXED_NOW);
    const result = await service.resendInvite({
      actorUserId: 'admin_1',
      email: ' INVITEE@kody.test ',
    });

    expect(callOrder).toEqual(['updateMany', 'create']);
    expect(prisma.inviteToken.updateMany).toHaveBeenCalledWith({
      where: { email: 'invitee@kody.test', usedAt: null },
      data: { usedAt: FIXED_NOW },
    });
    expect(prisma.inviteToken.create).toHaveBeenCalledTimes(1);
    expect(prisma.inviteToken.create).toHaveBeenCalledWith({
      data: {
        email: 'invitee@kody.test',
        tokenHash: hashInviteToken(result.token),
        invitedByUserId: 'admin_1',
        expiresAt: EXPECTED_EXPIRES_AT,
        usedAt: null,
      },
    });
    expect(result.id).toBe('invite_2');
    expect(result.email).toBe('invitee@kody.test');
    expect(result.expiresAt).toEqual(EXPECTED_EXPIRES_AT);
  });
});

describe('InviteService.validateInvite', () => {
  it('throws INVITE_TOKEN_INVALID when no invite row matches the token hash', async () => {
    const prisma = buildInvitePrisma({ inviteByHash: null });
    const service = new InviteService(prisma as never, () => FIXED_NOW);

    await expect(service.validateInvite('unknown-token')).rejects.toMatchObject({
      code: 'INVITE_TOKEN_INVALID',
      statusCode: 400,
    });
    expect(prisma.inviteToken.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: hashInviteToken('unknown-token') },
    });
  });

  it('throws INVITE_TOKEN_USED when the invite row already has a usedAt', async () => {
    const prisma = buildInvitePrisma({
      inviteByHash: {
        id: 'invite_1',
        email: 'invitee@kody.test',
        tokenHash: hashInviteToken('used-token'),
        invitedByUserId: 'admin_1',
        expiresAt: EXPECTED_EXPIRES_AT,
        usedAt: new Date('2026-05-10T00:00:00.000Z'),
      },
    });
    const service = new InviteService(prisma as never, () => FIXED_NOW);

    await expect(service.validateInvite('used-token')).rejects.toMatchObject({
      code: 'INVITE_TOKEN_USED',
      statusCode: 410,
    });
  });

  it('throws INVITE_TOKEN_EXPIRED when expiresAt is exactly equal to now', async () => {
    const prisma = buildInvitePrisma({
      inviteByHash: {
        id: 'invite_1',
        email: 'invitee@kody.test',
        tokenHash: hashInviteToken('expired-token'),
        invitedByUserId: 'admin_1',
        expiresAt: FIXED_NOW,
        usedAt: null,
      },
    });
    const service = new InviteService(prisma as never, () => FIXED_NOW);

    await expect(service.validateInvite('expired-token')).rejects.toMatchObject({
      code: 'INVITE_TOKEN_EXPIRED',
      statusCode: 410,
    });
  });

  it('throws INVITE_TOKEN_EXPIRED when expiresAt is one millisecond before now', async () => {
    const prisma = buildInvitePrisma({
      inviteByHash: {
        id: 'invite_1',
        email: 'invitee@kody.test',
        tokenHash: hashInviteToken('expired-token'),
        invitedByUserId: 'admin_1',
        expiresAt: new Date(FIXED_NOW.getTime() - 1),
        usedAt: null,
      },
    });
    const service = new InviteService(prisma as never, () => FIXED_NOW);

    await expect(service.validateInvite('expired-token')).rejects.toMatchObject({
      code: 'INVITE_TOKEN_EXPIRED',
      statusCode: 410,
    });
  });

  it('returns { email, expiresAt } only on a valid token', async () => {
    const prisma = buildInvitePrisma({
      inviteByHash: {
        id: 'invite_1',
        email: 'invitee@kody.test',
        tokenHash: hashInviteToken('valid-token'),
        invitedByUserId: 'admin_1',
        expiresAt: EXPECTED_EXPIRES_AT,
        usedAt: null,
      },
    });
    const service = new InviteService(prisma as never, () => FIXED_NOW);

    const result = await service.validateInvite('valid-token');

    expect(result).toEqual({
      email: 'invitee@kody.test',
      expiresAt: EXPECTED_EXPIRES_AT,
    });
    expect(Object.keys(result)).toEqual(['email', 'expiresAt']);
  });
});

describe('InviteService.consumeInvite', () => {
  const validInvite = {
    id: 'invite_1',
    email: 'invitee@kody.test',
    tokenHash: hashInviteToken('valid-token'),
    invitedByUserId: 'admin_1',
    expiresAt: EXPECTED_EXPIRES_AT,
    usedAt: null as Date | null,
  };
  const activeEmployee = { id: 'employee_1', email: 'invitee@kody.test', status: 'ACTIVE' as const };

  it('throws INVITE_TOKEN_INVALID before any user.create when no invite matches', async () => {
    const prisma = buildInvitePrisma({ inviteByHash: null, employee: activeEmployee });
    const service = new InviteService(prisma as never, () => FIXED_NOW);

    await expect(
      service.consumeInvite({
        token: 'unknown',
        password: 'Password123',
        displayName: 'New User',
      }),
    ).rejects.toMatchObject({ code: 'INVITE_TOKEN_INVALID', statusCode: 400 });
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('throws INVITE_TOKEN_USED before any user.create when invite has been consumed', async () => {
    const prisma = buildInvitePrisma({
      inviteByHash: { ...validInvite, usedAt: new Date('2026-05-10T00:00:00.000Z') },
      employee: activeEmployee,
    });
    const service = new InviteService(prisma as never, () => FIXED_NOW);

    await expect(
      service.consumeInvite({
        token: 'valid-token',
        password: 'Password123',
        displayName: 'New User',
      }),
    ).rejects.toMatchObject({ code: 'INVITE_TOKEN_USED', statusCode: 410 });
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('throws INVITE_TOKEN_EXPIRED before any user.create when invite is past expiry', async () => {
    const prisma = buildInvitePrisma({
      inviteByHash: { ...validInvite, expiresAt: new Date(FIXED_NOW.getTime() - 1) },
      employee: activeEmployee,
    });
    const service = new InviteService(prisma as never, () => FIXED_NOW);

    await expect(
      service.consumeInvite({
        token: 'valid-token',
        password: 'Password123',
        displayName: 'New User',
      }),
    ).rejects.toMatchObject({ code: 'INVITE_TOKEN_EXPIRED', statusCode: 410 });
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('throws EMPLOYEE_NOT_FOUND before any user.create when the invite-bound employee is missing', async () => {
    const prisma = buildInvitePrisma({ inviteByHash: validInvite, employee: null });
    const service = new InviteService(prisma as never, () => FIXED_NOW);

    await expect(
      service.consumeInvite({
        token: 'valid-token',
        password: 'Password123',
        displayName: 'New User',
      }),
    ).rejects.toMatchObject({ code: 'EMPLOYEE_NOT_FOUND', statusCode: 404 });
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('throws EMPLOYEE_INACTIVE before any user.create when the invite-bound employee is INACTIVE', async () => {
    const prisma = buildInvitePrisma({
      inviteByHash: validInvite,
      employee: { ...activeEmployee, status: 'INACTIVE' },
    });
    const service = new InviteService(prisma as never, () => FIXED_NOW);

    await expect(
      service.consumeInvite({
        token: 'valid-token',
        password: 'Password123',
        displayName: 'New User',
      }),
    ).rejects.toMatchObject({ code: 'EMPLOYEE_INACTIVE', statusCode: 403 });
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('throws USER_ALREADY_EXISTS before any user.create when a user is already linked', async () => {
    const prisma = buildInvitePrisma({
      inviteByHash: validInvite,
      employee: activeEmployee,
      existingUser: { id: 'user_existing', employeeId: 'employee_1', email: 'invitee@kody.test' },
    });
    const service = new InviteService(prisma as never, () => FIXED_NOW);

    await expect(
      service.consumeInvite({
        token: 'valid-token',
        password: 'Password123',
        displayName: 'New User',
      }),
    ).rejects.toMatchObject({ code: 'USER_ALREADY_EXISTS', statusCode: 409 });
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('throws INVALID_DISPLAY_NAME when displayName is whitespace-only and does not create a user', async () => {
    const prisma = buildInvitePrisma({ inviteByHash: validInvite, employee: activeEmployee });
    const service = new InviteService(prisma as never, () => FIXED_NOW);

    await expect(
      service.consumeInvite({
        token: 'valid-token',
        password: 'Password123',
        displayName: '   ',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_DISPLAY_NAME', statusCode: 400 });
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('throws PASSWORD_POLICY_FAILED for a weak password and does not create a user', async () => {
    const prisma = buildInvitePrisma({ inviteByHash: validInvite, employee: activeEmployee });
    const service = new InviteService(prisma as never, () => FIXED_NOW);

    await expect(
      service.consumeInvite({
        token: 'valid-token',
        password: 'weak',
        displayName: 'New User',
      }),
    ).rejects.toMatchObject({ code: 'PASSWORD_POLICY_FAILED', statusCode: 400 });
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('creates user and marks invite usedAt inside $transaction, returns the user body, no roles, no actionLog', async () => {
    const prisma = buildInvitePrisma({ inviteByHash: validInvite, employee: activeEmployee });
    const service = new InviteService(prisma as never, () => FIXED_NOW);

    const result = await service.consumeInvite({
      token: 'valid-token',
      password: 'Password123',
      displayName: '  Trimmed Name  ',
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.user.create).toHaveBeenCalledTimes(1);
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        employeeId: 'employee_1',
        email: 'invitee@kody.test',
        passwordHash: expect.any(String),
        displayName: 'Trimmed Name',
        status: 'ACTIVE',
      },
    });
    expect(prisma.inviteToken.update).toHaveBeenCalledTimes(1);
    expect(prisma.inviteToken.update).toHaveBeenCalledWith({
      where: { id: 'invite_1' },
      data: { usedAt: FIXED_NOW },
    });

    const transactionArgs = prisma.$transaction.mock.calls[0]?.[0];
    expect(Array.isArray(transactionArgs)).toBe(true);
    expect(transactionArgs).toHaveLength(2);

    expect(result).toEqual({
      user: {
        id: 'user_new',
        employeeId: 'employee_1',
        email: 'invitee@kody.test',
        displayName: 'Trimmed Name',
        status: 'ACTIVE',
        roles: [],
      },
    });
    expect(prisma.actionLog.create).not.toHaveBeenCalled();
  });
});

interface InvitePrismaSpec {
  employee?: { id: string; email: string; status: 'ACTIVE' | 'INACTIVE' } | null;
  existingUser?: { id: string; employeeId: string; email: string } | null;
  createReturn?: { id: string };
  priorInvites?: Array<{ id: string; email: string; usedAt: Date | null }>;
  inviteByHash?: {
    id: string;
    email: string;
    tokenHash: string;
    invitedByUserId: string;
    expiresAt: Date;
    usedAt: Date | null;
  } | null;
}

function buildInvitePrisma(spec: InvitePrismaSpec) {
  return {
    employee: {
      findUnique: vi.fn(async () => spec.employee ?? null),
    },
    user: {
      findFirst: vi.fn(async () => spec.existingUser ?? null),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
        id: 'user_new',
        ...args.data,
      })),
    },
    inviteToken: {
      findUnique: vi.fn(async () => spec.inviteByHash ?? null),
      findFirst: vi.fn(async () => spec.priorInvites?.find((row) => row.usedAt === null) ?? null),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
        id: spec.createReturn?.id ?? 'invite_new',
        ...args.data,
      })),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: spec.priorInvites?.filter((r) => r.usedAt === null).length ?? 0 })),
    },
    actionLog: {
      create: vi.fn(async () => ({})),
    },
    $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
  };
}
