import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { issueAccessToken } from '@/domain/auth/tokens.js';
import type { Role, UserStatus } from '@/domain/shared/types.js';
import { buildTestServer as _buildTestServer } from './helpers.js';

function buildTestServer(prisma: Partial<PrismaClient>) {
  return _buildTestServer(prisma);
}

describe('storefront public adapter preview route', () => {
  it('rejects unauthenticated preview access as an OMS-internal route', async () => {
    const server = buildTestServer(buildPrisma({ actor: buildActor() }));
    await server.ready();

    const response = await server.inject({ method: 'GET', url: '/storefront/public-adapter/preview' });
    const body = response.json();

    expect(response.statusCode).toBe(401);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('AUTHENTICATION_ERROR');

    await server.close();
  });

  it('returns preview-only disabled public adapter flags for product readers without DB writes', async () => {
    const actor = buildActor({ roles: ['SALES'] });
    const prisma = buildPrisma({ actor });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/storefront/public-adapter/preview',
      headers: { authorization: `Bearer ${issueToken(actor.id, ['SALES'])}` },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body).toEqual({
      ok: true,
      data: {
        previewOnly: true,
        publishEnabled: false,
        externalSyncEnabled: false,
        source: 'OMS_PRODUCT_PUBLIC_SALE_WINDOW',
        calendar: {
          publicEvents: [],
          reason: 'PRODUCT_LEVEL_SALE_WINDOW_NOT_APPROVED',
          variantSaleWindowsUsed: false,
        },
      },
    });
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.product?.findMany).not.toHaveBeenCalled();
    expect(prisma.actionLog.create).not.toHaveBeenCalled();

    await server.close();
  });
});

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
  return {
    id,
    employeeId: `${id}_emp`,
    email: `${id}@kody.test`,
    loginId: id,
    passwordHash: 'unused',
    displayName: `User ${id}`,
    profileImageUrl: null,
    status: input.status ?? 'ACTIVE',
    failedLoginCount: 0,
    lockedUntil: null,
    lastLoginAt: null,
    createdAt: new Date('2026-05-27T00:00:00Z'),
    updatedAt: new Date('2026-05-27T00:00:00Z'),
    roles: roles.map((role) => ({ role })),
  };
}

function buildPrisma(input: { actor: ReturnType<typeof buildActor> }) {
  return {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; loginId?: string } }) => {
        if (where.id === input.actor.id || where.loginId === input.actor.loginId) return input.actor;
        return null;
      }),
      update: vi.fn(),
    },
    refreshToken: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    product: {
      findMany: vi.fn(),
    },
    actionLog: {
      create: vi.fn(),
    },
  } as unknown as Partial<PrismaClient> & {
    user: { findUnique: ReturnType<typeof vi.fn> };
    product: { findMany: ReturnType<typeof vi.fn> };
    actionLog: { create: ReturnType<typeof vi.fn> };
  };
}
