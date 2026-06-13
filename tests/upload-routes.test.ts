import { describe, expect, it } from 'vitest';
import { issueAccessToken } from '@/domain/auth/tokens.js';
import type { Role } from '@/domain/shared/types.js';
import type { PrismaClient } from '@prisma/client';
import { buildTestServer } from './helpers.js';

const PNG_1X1_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

describe('upload routes', () => {
  it('uploads product detail image and returns a stable image URL', async () => {
    const actor = buildActor();
    const server = buildTestServer(buildPrisma(actor) as unknown as Partial<PrismaClient>);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/uploads/product-detail-images',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: {
        fileName: 'detail.png',
        contentType: 'image/png',
        contentBase64: PNG_1X1_BASE64,
        draftId: 'draft_1',
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.data).toMatchObject({
      contentType: 'image/png',
      storage: 'local',
    });
    expect(body.data.url).toContain('/uploads/product-detail-images/local/product-detail%2Fdrafts%2Fdraft_1%2F');
    expect(body.data.key).toContain('product-detail/drafts/draft_1/');
    expect(body.data.sizeBytes).toBeGreaterThan(0);

    const imageResponse = await server.inject({ method: 'GET', url: new URL(body.data.url).pathname });
    expect(imageResponse.statusCode).toBe(200);
    expect(imageResponse.headers['content-type']).toBe('image/png');

    await server.close();
  });

  it('rejects unsupported product detail image types', async () => {
    const actor = buildActor();
    const server = buildTestServer(buildPrisma(actor) as unknown as Partial<PrismaClient>);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/uploads/product-detail-images',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: {
        fileName: 'detail.svg',
        contentType: 'image/svg+xml',
        contentBase64: PNG_1X1_BASE64,
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');

    await server.close();
  });
});

function issueToken(userId: string, roles: Role[]): string {
  return issueAccessToken(
    { sub: userId, email: `${userId}@kody.test`, roles },
    'test-secret',
  ).token;
}

function buildActor(input: { id?: string; roles?: Role[] } = {}) {
  const id = input.id ?? 'admin_1';
  const roles = input.roles ?? ['ADMIN'];
  return {
    id,
    employeeId: `${id}_emp`,
    email: `${id}@kody.test`,
    passwordHash: 'unused',
    displayName: `User ${id}`,
    profileImageUrl: null,
    status: 'ACTIVE',
    failedLoginCount: 0,
    lockedUntil: null,
    lastLoginAt: null,
    createdAt: new Date('2026-05-27T00:00:00Z'),
    updatedAt: new Date('2026-05-27T00:00:00Z'),
    roles: roles.map((role) => ({ role })),
    employee: { id: `${id}_emp`, name: `Emp ${id}`, email: `${id}@kody.test`, phone: null, department: null, position: null, status: 'ACTIVE' },
  };
}

function buildPrisma(actor: ReturnType<typeof buildActor>) {
  return {
    user: {
      findUnique: async (args: { where: { id: string } }) => (args.where.id === actor.id ? actor : null),
    },
  };
}
