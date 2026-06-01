import { describe, expect, it, vi } from 'vitest';
import { issueAccessToken } from '@/domain/auth/tokens.js';
import type { Role, UserStatus } from '@/domain/shared/types.js';
import { buildTestServer } from './helpers.js';

describe('invite admin routes', () => {
  it('rejects POST /admin/users/invite without bearer auth and does not call the service', async () => {
    const prisma = buildPrisma({});
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/admin/users/invite',
      payload: { email: 'invitee@kody.test', roles: ['SALES'] },
    });
    const body = response.json();

    expect(response.statusCode).toBe(401);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('AUTHENTICATION_ERROR');
    expect(prisma.inviteToken.create).not.toHaveBeenCalled();
    expect(prisma.actionLog.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('rejects POST /admin/users/invite from a non-admin role and does not call the service', async () => {
    const actor = buildActor({ id: 'sales_1', roles: ['SALES'] });
    const prisma = buildPrisma({ actor });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/admin/users/invite',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { email: 'invitee@kody.test', roles: ['SALES'] },
    });
    const body = response.json();

    expect(response.statusCode).toBe(403);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('AUTHORIZATION_ERROR');
    expect(prisma.inviteToken.create).not.toHaveBeenCalled();
    expect(prisma.actionLog.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('issues an invite for an active employee and returns the raw token once', async () => {
    const actor = buildActor({ id: 'admin_1', roles: ['ADMIN'] });
    const prisma = buildPrisma({
      actor,
      employee: { id: 'employee_1', email: 'invitee@kody.test', status: 'ACTIVE' },
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/admin/users/invite',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { email: ' INVITEE@kody.test ', roles: ['SALES'] },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data).toMatchObject({
      email: 'invitee@kody.test',
      id: expect.any(String),
      token: expect.any(String),
    });
    expect(typeof body.data.expiresAt).toBe('string');
    expect(body.data.token.length).toBeGreaterThanOrEqual(64);

    expect(prisma.inviteToken.create).toHaveBeenCalledTimes(1);
    const createArgs = prisma.inviteToken.create.mock.calls[0][0];
    expect(createArgs.data.email).toBe('invitee@kody.test');
    expect(createArgs.data.invitedByUserId).toBe(actor.id);
    expect(createArgs.data.usedAt).toBeNull();
    expect(createArgs.data.roles).toEqual({ create: [{ role: 'SALES' }] });
    expect(typeof createArgs.data.tokenHash).toBe('string');
    expect(createArgs.data.tokenHash).not.toBe(body.data.token);
    expect(prisma.actionLog.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('rejects POST /admin/users/invite when email is missing', async () => {
    const actor = buildActor({ id: 'admin_1', roles: ['ADMIN'] });
    const prisma = buildPrisma({ actor });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/admin/users/invite',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: {},
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(prisma.inviteToken.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('rejects POST /admin/users/invite when body is not an object', async () => {
    const actor = buildActor({ id: 'admin_1', roles: ['ADMIN'] });
    const prisma = buildPrisma({ actor });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/admin/users/invite',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: ['nope'],
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(prisma.inviteToken.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('surfaces EMPLOYEE_NOT_FOUND when no employee exists for the email', async () => {
    const actor = buildActor({ id: 'admin_1', roles: ['ADMIN'] });
    const prisma = buildPrisma({ actor, employee: null });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/admin/users/invite',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { email: 'missing@kody.test', roles: ['SALES'] },
    });
    const body = response.json();

    expect(response.statusCode).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('EMPLOYEE_NOT_FOUND');
    expect(prisma.inviteToken.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('surfaces EMPLOYEE_INACTIVE when the employee is INACTIVE', async () => {
    const actor = buildActor({ id: 'admin_1', roles: ['ADMIN'] });
    const prisma = buildPrisma({
      actor,
      employee: { id: 'employee_1', email: 'inactive@kody.test', status: 'INACTIVE' },
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/admin/users/invite',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { email: 'inactive@kody.test', roles: ['SALES'] },
    });
    const body = response.json();

    expect(response.statusCode).toBe(403);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('EMPLOYEE_INACTIVE');
    expect(prisma.inviteToken.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('surfaces USER_ALREADY_EXISTS when a user is already linked to the employee', async () => {
    const actor = buildActor({ id: 'admin_1', roles: ['ADMIN'] });
    const prisma = buildPrisma({
      actor,
      employee: { id: 'employee_1', email: 'taken@kody.test', status: 'ACTIVE' },
      existingUser: { id: 'user_existing', employeeId: 'employee_1', email: 'taken@kody.test' },
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/admin/users/invite',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { email: 'taken@kody.test', roles: ['SALES'] },
    });
    const body = response.json();

    expect(response.statusCode).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('USER_ALREADY_EXISTS');
    expect(prisma.inviteToken.create).not.toHaveBeenCalled();

    await server.close();
  });
});

describe('invite resend route', () => {
  it('rejects POST /admin/users/invite/resend without bearer auth', async () => {
    const prisma = buildPrisma({});
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/admin/users/invite/resend',
      payload: { email: 'invitee@kody.test', roles: ['SALES'] },
    });
    const body = response.json();

    expect(response.statusCode).toBe(401);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('AUTHENTICATION_ERROR');
    expect(prisma.inviteToken.create).not.toHaveBeenCalled();
    expect(prisma.inviteToken.updateMany).not.toHaveBeenCalled();

    await server.close();
  });

  it('returns INVITE_NOT_FOUND when no prior unused invite exists and does not touch invite rows', async () => {
    const actor = buildActor({ id: 'admin_1', roles: ['ADMIN'] });
    const prisma = buildPrisma({
      actor,
      employee: { id: 'employee_1', email: 'invitee@kody.test', status: 'ACTIVE' },
      priorInvite: null,
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/admin/users/invite/resend',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { email: 'invitee@kody.test', roles: ['SALES'] },
    });
    const body = response.json();

    expect(response.statusCode).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('INVITE_NOT_FOUND');
    expect(prisma.inviteToken.updateMany).not.toHaveBeenCalled();
    expect(prisma.inviteToken.create).not.toHaveBeenCalled();
    expect(prisma.actionLog.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('invalidates prior unused invites and issues a fresh one when an approved invite exists', async () => {
    const actor = buildActor({ id: 'admin_1', roles: ['ADMIN'] });
    const prisma = buildPrisma({
      actor,
      employee: { id: 'employee_1', email: 'invitee@kody.test', status: 'ACTIVE' },
      priorInvite: {
        id: 'invite_prior',
        email: 'invitee@kody.test',
        tokenHash: 'prior-hash',
        invitedByUserId: 'admin_1',
        expiresAt: new Date('2026-05-12T00:00:00.000Z'),
        usedAt: null,
        roles: [{ role: 'SALES' as Role }],
      },
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/admin/users/invite/resend',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { email: 'invitee@kody.test', roles: ['SALES'] },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data).toMatchObject({
      email: 'invitee@kody.test',
      token: expect.any(String),
    });
    expect(prisma.inviteToken.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.inviteToken.updateMany).toHaveBeenCalledWith({
      where: { email: 'invitee@kody.test', usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
    expect(prisma.inviteToken.create).toHaveBeenCalledTimes(1);
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

function buildActor(input: { id: string; roles: Role[]; status?: UserStatus }) {
  return {
    id: input.id,
    employeeId: `${input.id}_employee`,
    email: `${input.id}@kody.test`,
    passwordHash: 'unused',
    displayName: `Actor ${input.id}`,
    profileImageUrl: null,
    status: input.status ?? 'ACTIVE',
    failedLoginCount: 0,
    lockedUntil: null,
    lastLoginAt: null,
    roles: input.roles.map((role) => ({ role })),
  };
}

interface InviteRoutePrismaSpec {
  actor?: ReturnType<typeof buildActor>;
  employee?: { id: string; email: string; status: 'ACTIVE' | 'INACTIVE' } | null;
  existingUser?: { id: string; employeeId: string; email: string } | null;
  priorInvite?: {
    id: string;
    email: string;
    tokenHash: string;
    invitedByUserId: string;
    expiresAt: Date;
    usedAt: Date | null;
    roles?: Array<{ role: Role }>;
  } | null;
}

function buildPrisma(spec: InviteRoutePrismaSpec) {
  return {
    user: {
      findUnique: vi.fn(async (args: { where: { id?: string } }) => {
        if (spec.actor && args.where.id === spec.actor.id) {
          return spec.actor;
        }
        return null;
      }),
      findFirst: vi.fn(async () => spec.existingUser ?? null),
    },
    employee: {
      findUnique: vi.fn(async () => spec.employee ?? null),
    },
    userRole: {
      createMany: vi.fn(async () => ({ count: 1 })),
    },
    inviteToken: {
      findUnique: vi.fn(async () => null),
      findFirst: vi.fn(async () => spec.priorInvite ?? null),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
        id: 'invite_new',
        ...args.data,
      })),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
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
