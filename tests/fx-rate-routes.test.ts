import { describe, expect, it, vi } from 'vitest';
import { issueAccessToken } from '@/domain/auth/tokens.js';
import type { Currency, Role, UserStatus } from '@/domain/shared/types.js';
import { buildTestServer as _buildTestServer } from './helpers.js';
import type { PrismaClient } from '@prisma/client';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildTestServer(prisma: any) {
  return _buildTestServer(prisma as Partial<PrismaClient>);
}

describe('fx-rate routes', () => {
  it('rejects SALES from POST /fx-rates as AUTHORIZATION_ERROR', async () => {
    const actor = buildActor({ roles: ['SALES'] });
    const prisma = buildPrisma({ actor });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/fx-rates',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { date: '2026-05-27', currency: 'USD', rateToKRW: '1350.50' },
    });
    expect(response.statusCode).toBe(403);
    await server.close();
  });

  it('allows FINANCE to POST /fx-rates, returns 201, and writes an FxRate audit log', async () => {
    const actor = buildActor({ roles: ['FINANCE'] });
    const prisma = buildPrisma({ actor });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/fx-rates',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { date: '2026-05-27', currency: 'USD', rateToKRW: '1350.50' },
    });
    const body = response.json();
    expect(response.statusCode).toBe(201);
    expect(body.ok).toBe(true);
    expect(prisma.actionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: actor.id,
        actionType: 'PAYMENT_UPDATE',
        targetType: 'FxRate',
        targetId: 'fx_upserted',
        afterJson: expect.objectContaining({ currency: 'USD', rateToKRW: '1350.50' }),
        metadataJson: expect.objectContaining({ scope: 'fx_rate_upsert', currency: 'USD' }),
      }),
    });
    await server.close();
  });

  it('allows SALES to GET /fx-rates', async () => {
    const actor = buildActor({ roles: ['SALES'] });
    const prisma = buildPrisma({
      actor,
      fxRates: [{ id: 'fx_1', date: new Date(), currency: 'USD' as Currency, rateToKRW: { toString: () => '1350.50' }, createdAt: new Date() }],
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/fx-rates',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });
    const body = response.json();
    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    await server.close();
  });
});

// ── Fixtures ──────────────────────────────────────────────────────────────

function issueToken(userId: string, roles: Role[]): string {
  return issueAccessToken(
    { sub: userId, email: `${userId}@kody.test`, roles },
    'test-secret',
  ).token;
}

interface ActorInput { id?: string; roles?: Role[]; status?: UserStatus }

function buildActor(input: ActorInput = {}) {
  const id = input.id ?? 'admin_1';
  const roles = input.roles ?? ['ADMIN'];
  const status: UserStatus = input.status ?? 'ACTIVE';
  return {
    id, employeeId: `${id}_emp`, email: `${id}@kody.test`,
    passwordHash: 'unused', displayName: `User ${id}`,
    profileImageUrl: null, status,
    failedLoginCount: 0, lockedUntil: null, lastLoginAt: null,
    createdAt: new Date('2026-05-27T00:00:00Z'),
    updatedAt: new Date('2026-05-27T00:00:00Z'),
    roles: roles.map((role) => ({ role })),
    employee: { id: `${id}_emp`, name: `Emp ${id}`, email: `${id}@kody.test`, phone: null, department: null, position: null, status: 'ACTIVE' },
  };
}

interface StoredFxRate { id: string; date: Date; currency: Currency; rateToKRW: { toString(): string }; createdAt: Date }

interface PrismaInput {
  actor: ReturnType<typeof buildActor>;
  fxRates?: StoredFxRate[];
}

function buildPrisma(input: PrismaInput) {
  const fxRates = input.fxRates ?? [];
  const upsertedFxRate: StoredFxRate = {
    id: 'fx_upserted',
    date: new Date('2026-05-27T00:00:00Z'),
    currency: 'USD',
    rateToKRW: { toString: () => '1350.50' },
    createdAt: new Date('2026-05-27T00:00:00Z'),
  };

  return {
    user: {
      findUnique: vi.fn(async (args: { where: { id: string } }) => {
        if (args.where.id === input.actor.id) return input.actor;
        return null;
      }),
    },
    account: {
      findUnique: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      create: vi.fn(async () => { throw new Error('not used'); }),
      update: vi.fn(async () => { throw new Error('not used'); }),
    },
    payment: {
      create: vi.fn(async () => { throw new Error('not used'); }),
      findUnique: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      update: vi.fn(async () => { throw new Error('not used'); }),
      delete: vi.fn(async () => { throw new Error('not used'); }),
      groupBy: vi.fn(async () => []),
    },
    fxRate: {
      upsert: vi.fn(async () => upsertedFxRate),
      findMany: vi.fn(async () => fxRates),
    },
    refreshToken: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
    },
    actionLog: { create: vi.fn(async () => ({})) },
  };
}
