import { describe, expect, it, vi } from 'vitest';
import { issueAccessToken } from '@/domain/auth/tokens.js';
import type { Role, UserStatus } from '@/domain/shared/types.js';
import { buildTestServer as _buildTestServer } from './helpers.js';
import type { PrismaClient } from '@prisma/client';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildTestServer(prisma: any) {
  return _buildTestServer(prisma as Partial<PrismaClient>);
}

const ARTIST_ID = 'artist_1';

describe('artist routes', () => {
  it('rejects unauthenticated POST /artists as AUTHENTICATION_ERROR', async () => {
    const prisma = buildPrisma({ actor: buildActor() });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/artists',
      payload: { name: 'ATEZ', memberCount: 5 },
    });
    const body = response.json();

    expect(response.statusCode).toBe(401);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('AUTHENTICATION_ERROR');

    await server.close();
  });

  it('rejects SALES from POST /artists as AUTHORIZATION_ERROR', async () => {
    const actor = buildActor({ roles: ['SALES'] });
    const prisma = buildPrisma({ actor });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/artists',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { name: 'ATEZ', memberCount: 5 },
    });
    const body = response.json();

    expect(response.statusCode).toBe(403);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('AUTHORIZATION_ERROR');

    await server.close();
  });

  it('creates an artist and returns 201', async () => {
    const actor = buildActor();
    const stored = buildStoredArtist();
    const prisma = buildPrisma({ actor, createdArtist: stored });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/artists',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { name: 'ATEZ', memberCount: 5 },
    });
    const body = response.json();

    expect(response.statusCode).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.data.id).toBe(stored.id);
    expect(body.data.name).toBe(stored.name);

    await server.close();
  });

  it('returns 400 when name is missing on POST', async () => {
    const actor = buildActor();
    const prisma = buildPrisma({ actor });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/artists',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { memberCount: 5 },
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body.ok).toBe(false);

    await server.close();
  });

  it('lists artists and returns 200', async () => {
    const actor = buildActor();
    const artists = [buildStoredArtist(), buildStoredArtist({ id: 'artist_2', name: 'LUVSTAR' })];
    const prisma = buildPrisma({ actor, artists });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/artists',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(2);

    await server.close();
  });

  it('allows SALES to GET /artists (read access)', async () => {
    const actor = buildActor({ roles: ['SALES'] });
    const prisma = buildPrisma({ actor, artists: [buildStoredArtist()] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/artists',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });

    expect(response.statusCode).toBe(200);

    await server.close();
  });

  it('returns artist detail on GET /artists/:id', async () => {
    const actor = buildActor();
    const artist = buildStoredArtist();
    const prisma = buildPrisma({ actor, artists: [artist] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: `/artists/${ARTIST_ID}`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.id).toBe(artist.id);

    await server.close();
  });

  it('returns 404 on GET /artists/:id when not found', async () => {
    const actor = buildActor();
    const prisma = buildPrisma({ actor, artists: [] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/artists/missing',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });
    const body = response.json();

    expect(response.statusCode).toBe(404);
    expect(body.error.code).toBe('ARTIST_NOT_FOUND');

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

function buildStoredArtist(overrides: Partial<{ id: string; name: string; memberCount: number }> = {}) {
  return {
    id: overrides.id ?? ARTIST_ID,
    name: overrides.name ?? 'ATEZ',
    memberCount: overrides.memberCount ?? 5,
    createdAt: new Date('2026-05-27T00:00:00Z'),
  };
}

interface PrismaInput {
  actor: ReturnType<typeof buildActor>;
  artists?: ReturnType<typeof buildStoredArtist>[];
  createdArtist?: ReturnType<typeof buildStoredArtist>;
}

function buildPrisma(input: PrismaInput) {
  const artists = input.artists ?? [];
  return {
    user: {
      findUnique: vi.fn(async (args: { where: { id: string } }) => {
        if (args.where.id === input.actor.id) return input.actor;
        return null;
      }),
    },
    artist: {
      create: vi.fn(async () => {
        if (!input.createdArtist) throw new Error('createdArtist not provided');
        return input.createdArtist;
      }),
      findUnique: vi.fn(async (args: { where: { id: string } }) => {
        return artists.find((a) => a.id === args.where.id) ?? null;
      }),
      findMany: vi.fn(async () => artists),
    },
    product: {
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => null),
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => { throw new Error('not used'); }),
      update: vi.fn(async () => { throw new Error('not used'); }),
    },
    stockMovement: {
      create: vi.fn(async () => ({})),
      findMany: vi.fn(async () => []),
    },
    refreshToken: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
    },
    actionLog: { create: vi.fn(async () => ({})) },
  };
}
