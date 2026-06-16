import { describe, expect, it, vi } from 'vitest';
import { issueAccessToken } from '@/domain/auth/tokens.js';
import type { Role } from '@/domain/shared/types.js';
import { buildTestServer } from './helpers.js';

describe('admin employee routes', () => {
  it('allows ADMIN to list employee master records', async () => {
    const actor = buildUser({ id: 'admin_1', roles: ['ADMIN'] });
    const employee = buildEmployee({ id: 'employee_1', email: 'staff@kody.test' });
    const prisma = buildPrisma({ actor, employees: [employee] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/admin/employees',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data).toEqual([
      {
        id: employee.id,
        name: employee.name,
        email: employee.email,
        phone: employee.phone,
        department: employee.department,
        position: employee.position,
        status: employee.status,
        joinedAt: employee.joinedAt.toISOString(),
        leftAt: null,
        createdAt: employee.createdAt.toISOString(),
        updatedAt: employee.updatedAt.toISOString(),
        hasUser: false,
      },
    ]);
    expect(prisma.employee.findMany).toHaveBeenCalledWith({
      include: { user: { select: { id: true } } },
      orderBy: { createdAt: 'desc' },
    });

    await server.close();
  });

  it('allows ADMIN to create an active employee for later invite', async () => {
    const actor = buildUser({ id: 'admin_1', roles: ['ADMIN'] });
    const created = buildEmployee({
      id: 'employee_2',
      name: 'New Staff',
      email: 'new.staff@kody.test',
      department: 'Operations',
      position: 'Coordinator',
      phone: '010-0000-0000',
    });
    const prisma = buildPrisma({ actor, employees: [], createdEmployee: created });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/admin/employees',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: {
        name: ' New Staff ',
        email: ' NEW.STAFF@KODY.TEST ',
        department: 'Operations',
        position: 'Coordinator',
        phone: '010-0000-0000',
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.data).toMatchObject({
      id: created.id,
      name: 'New Staff',
      email: 'new.staff@kody.test',
      department: 'Operations',
      position: 'Coordinator',
      phone: '010-0000-0000',
      status: 'ACTIVE',
      hasUser: false,
    });
    expect(prisma.employee.create).toHaveBeenCalledWith({
      data: {
        name: 'New Staff',
        email: 'new.staff@kody.test',
        phone: '010-0000-0000',
        department: 'Operations',
        position: 'Coordinator',
        status: 'ACTIVE',
      },
      include: { user: { select: { id: true } } },
    });
    expect(prisma.actionLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.actionLog.create).toHaveBeenCalledWith({
      data: {
        actorUserId: actor.id,
        actionType: 'USER_STATUS_CHANGE',
        targetType: 'Employee',
        targetId: created.id,
        beforeJson: { status: null },
        afterJson: { status: 'ACTIVE' },
        metadataJson: { event: 'EMPLOYEE_CREATE', requestId: expect.any(String) },
        ipAddress: '127.0.0.1',
        userAgent: 'lightMyRequest',
      },
    });

    await server.close();
  });

  it('allows ADMIN to mark an employee inactive', async () => {
    const actor = buildUser({ id: 'admin_1', roles: ['ADMIN'] });
    const employee = buildEmployee({ id: 'employee_1', status: 'ACTIVE' });
    const updated = { ...employee, status: 'INACTIVE' as const, leftAt: new Date('2026-05-29T00:00:00.000Z') };
    const prisma = buildPrisma({ actor, employees: [employee], updatedEmployee: updated });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'PATCH',
      url: `/admin/employees/${employee.id}/status`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { status: 'INACTIVE', leftAt: '2026-05-29T00:00:00.000Z' },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.status).toBe('INACTIVE');
    expect(body.data.leftAt).toBe('2026-05-29T00:00:00.000Z');
    expect(prisma.employee.update).toHaveBeenCalledWith({
      where: { id: employee.id },
      data: { status: 'INACTIVE', leftAt: new Date('2026-05-29T00:00:00.000Z') },
      include: { user: { select: { id: true } } },
    });
    expect(prisma.actionLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.actionLog.create).toHaveBeenCalledWith({
      data: {
        actorUserId: actor.id,
        actionType: 'USER_STATUS_CHANGE',
        targetType: 'Employee',
        targetId: employee.id,
        afterJson: { status: 'INACTIVE', leftAt: '2026-05-29T00:00:00.000Z' },
        metadataJson: { requestId: expect.any(String) },
        ipAddress: '127.0.0.1',
        userAgent: 'lightMyRequest',
      },
    });

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

function buildUser(input: { id: string; roles: Role[] }) {
  return {
    id: input.id,
    employeeId: `${input.id}_employee`,
    email: `${input.id}@kody.test`,
    loginId: input.id,
    passwordHash: 'unused',
    displayName: `User ${input.id}`,
    profileImageUrl: null,
    status: 'ACTIVE',
    failedLoginCount: 0,
    lockedUntil: null,
    roles: input.roles.map((role) => ({ role })),
  };
}

function buildEmployee(input: {
  id: string;
  name?: string;
  email?: string;
  phone?: string | null;
  department?: string | null;
  position?: string | null;
  status?: 'ACTIVE' | 'INACTIVE';
  user?: { id: string } | null;
}) {
  return {
    id: input.id,
    name: input.name ?? `Employee ${input.id}`,
    email: input.email ?? `${input.id}@kody.test`,
    phone: input.phone ?? null,
    department: input.department ?? 'Ops',
    position: input.position ?? 'Manager',
    status: input.status ?? 'ACTIVE',
    joinedAt: new Date('2026-05-01T00:00:00.000Z'),
    leftAt: null,
    createdAt: new Date('2026-05-07T00:00:00.000Z'),
    updatedAt: new Date('2026-05-07T00:00:00.000Z'),
    user: input.user ?? null,
  };
}

function buildPrisma(input: {
  actor: ReturnType<typeof buildUser>;
  employees: ReturnType<typeof buildEmployee>[];
  createdEmployee?: ReturnType<typeof buildEmployee>;
  updatedEmployee?: ReturnType<typeof buildEmployee>;
}) {
  return {
    user: {
      findUnique: vi.fn(async (args: { where: { id?: string } }) => {
        if (args.where.id === input.actor.id) return input.actor;
        return null;
      }),
      update: vi.fn(async () => ({})),
    },
    refreshToken: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
    },
    employee: {
      findMany: vi.fn(async () => input.employees),
      create: vi.fn(async () => input.createdEmployee),
      update: vi.fn(async () => input.updatedEmployee),
    },
    actionLog: {
      create: vi.fn(async () => ({})),
    },
  };
}
