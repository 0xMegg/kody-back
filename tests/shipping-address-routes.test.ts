import { describe, expect, it, vi } from 'vitest';
import { issueAccessToken } from '@/domain/auth/tokens.js';
import type { PrismaClient } from '@prisma/client';
import type { Incoterm, Role, UserStatus } from '@/domain/shared/types.js';
import { buildTestServer as _buildTestServer } from './helpers.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildTestServer(prisma: any) {
  return _buildTestServer(prisma as Partial<PrismaClient>);
}

const ACCOUNT_ID = 'acc_1';
const ADDRESS_ID = 'addr_1';

describe('shipping address routes', () => {
  // ── POST /accounts/:accountId/addresses ──────────────────────────────────

  it('rejects unauthenticated POST as AUTHENTICATION_ERROR', async () => {
    const prisma = buildPrisma({ actor: buildActor() });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: `/accounts/${ACCOUNT_ID}/addresses`,
      payload: validCreatePayload(),
    });
    const body = response.json();

    expect(response.statusCode).toBe(401);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('AUTHENTICATION_ERROR');

    await server.close();
  });

  it('rejects WAREHOUSE from POST as AUTHORIZATION_ERROR', async () => {
    const actor = buildActor({ roles: ['WAREHOUSE'] });
    const prisma = buildPrisma({ actor, accounts: [buildStoredAccount()] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: `/accounts/${ACCOUNT_ID}/addresses`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: validCreatePayload(),
    });
    const body = response.json();

    expect(response.statusCode).toBe(403);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('AUTHORIZATION_ERROR');

    await server.close();
  });

  it('returns 404 when account not found on POST', async () => {
    const actor = buildActor();
    const prisma = buildPrisma({ actor, accounts: [] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: `/accounts/${ACCOUNT_ID}/addresses`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: validCreatePayload(),
    });
    const body = response.json();

    expect(response.statusCode).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('ACCOUNT_NOT_FOUND');

    await server.close();
  });

  it('returns 400 when required field label is missing on POST', async () => {
    const actor = buildActor();
    const prisma = buildPrisma({ actor, accounts: [buildStoredAccount()] });
    const server = buildTestServer(prisma);
    await server.ready();

    const { label: _omit, ...withoutLabel } = validCreatePayload();

    const response = await server.inject({
      method: 'POST',
      url: `/accounts/${ACCOUNT_ID}/addresses`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: withoutLabel,
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body.ok).toBe(false);

    await server.close();
  });

  it('creates a shipping address and returns 201', async () => {
    const actor = buildActor();
    const stored = buildStoredAddress();
    const prisma = buildPrisma({ actor, accounts: [buildStoredAccount()], createdAddress: stored });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: `/accounts/${ACCOUNT_ID}/addresses`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: validCreatePayload(),
    });
    const body = response.json();

    expect(response.statusCode).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.data.id).toBe(stored.id);
    expect(body.data.accountId).toBe(stored.accountId);
    expect(body.data.label).toBe(stored.label);

    await server.close();
  });

  it('sets existing primary to false when new address is created with isPrimary true', async () => {
    const actor = buildActor();
    const existing = buildStoredAddress({ id: 'addr_old', isPrimary: true });
    const created = buildStoredAddress({ id: 'addr_new', isPrimary: true });
    const prisma = buildPrisma({
      actor,
      accounts: [buildStoredAccount()],
      addresses: [existing],
      createdAddress: created,
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: `/accounts/${ACCOUNT_ID}/addresses`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { ...validCreatePayload(), isPrimary: true },
    });
    const body = response.json();

    expect(response.statusCode).toBe(201);
    expect(body.ok).toBe(true);
    // transaction fn was called (updateMany then create)
    expect(prisma.shippingAddress.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isPrimary: false } }),
    );

    await server.close();
  });

  // ── GET /accounts/:accountId/addresses ───────────────────────────────────

  it('allows WAREHOUSE to GET address list', async () => {
    const actor = buildActor({ roles: ['WAREHOUSE'] });
    const addr = buildStoredAddress();
    const prisma = buildPrisma({ actor, accounts: [buildStoredAccount()], addresses: [addr] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: `/accounts/${ACCOUNT_ID}/addresses`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data).toBeInstanceOf(Array);

    await server.close();
  });

  it('returns 404 on GET list when account not found', async () => {
    const actor = buildActor();
    const prisma = buildPrisma({ actor, accounts: [] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: `/accounts/${ACCOUNT_ID}/addresses`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });
    const body = response.json();

    expect(response.statusCode).toBe(404);
    expect(body.error.code).toBe('ACCOUNT_NOT_FOUND');

    await server.close();
  });

  it('returns list sorted isPrimary first', async () => {
    const actor = buildActor();
    const secondary = buildStoredAddress({ id: 'addr_sec', isPrimary: false });
    const primary = buildStoredAddress({ id: 'addr_pri', isPrimary: true });
    const prisma = buildPrisma({
      actor,
      accounts: [buildStoredAccount()],
      addresses: [primary, secondary],
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: `/accounts/${ACCOUNT_ID}/addresses`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data[0].id).toBe('addr_pri');

    await server.close();
  });

  // ── GET /accounts/:accountId/addresses/:addressId ────────────────────────

  it('returns address detail on GET', async () => {
    const actor = buildActor();
    const addr = buildStoredAddress();
    const prisma = buildPrisma({ actor, accounts: [buildStoredAccount()], addresses: [addr] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: `/accounts/${ACCOUNT_ID}/addresses/${ADDRESS_ID}`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.id).toBe(addr.id);

    await server.close();
  });

  it('returns 404 on GET detail when address not found', async () => {
    const actor = buildActor();
    const prisma = buildPrisma({ actor, accounts: [buildStoredAccount()], addresses: [] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: `/accounts/${ACCOUNT_ID}/addresses/missing`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });
    const body = response.json();

    expect(response.statusCode).toBe(404);
    expect(body.error.code).toBe('SHIPPING_ADDRESS_NOT_FOUND');

    await server.close();
  });

  // ── PATCH /accounts/:accountId/addresses/:addressId ──────────────────────

  it('rejects WAREHOUSE from PATCH as AUTHORIZATION_ERROR', async () => {
    const actor = buildActor({ roles: ['WAREHOUSE'] });
    const addr = buildStoredAddress();
    const prisma = buildPrisma({ actor, accounts: [buildStoredAccount()], addresses: [addr] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'PATCH',
      url: `/accounts/${ACCOUNT_ID}/addresses/${ADDRESS_ID}`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { label: 'new' },
    });
    const body = response.json();

    expect(response.statusCode).toBe(403);
    expect(body.error.code).toBe('AUTHORIZATION_ERROR');

    await server.close();
  });

  it('partially updates address and returns 200', async () => {
    const actor = buildActor();
    const addr = buildStoredAddress();
    const updated = buildStoredAddress({ label: 'Updated Label' });
    const prisma = buildPrisma({
      actor,
      accounts: [buildStoredAccount()],
      addresses: [addr],
      updatedAddress: updated,
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'PATCH',
      url: `/accounts/${ACCOUNT_ID}/addresses/${ADDRESS_ID}`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { label: 'Updated Label' },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.label).toBe('Updated Label');

    await server.close();
  });

  it('unsets existing primary when PATCH sets isPrimary true', async () => {
    const actor = buildActor();
    const addr = buildStoredAddress({ isPrimary: false });
    const updated = buildStoredAddress({ isPrimary: true });
    const prisma = buildPrisma({
      actor,
      accounts: [buildStoredAccount()],
      addresses: [addr],
      updatedAddress: updated,
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'PATCH',
      url: `/accounts/${ACCOUNT_ID}/addresses/${ADDRESS_ID}`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { isPrimary: true },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(prisma.shippingAddress.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isPrimary: false } }),
    );

    await server.close();
  });

  it('returns 404 on PATCH when address not found', async () => {
    const actor = buildActor();
    const prisma = buildPrisma({ actor, accounts: [buildStoredAccount()], addresses: [] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'PATCH',
      url: `/accounts/${ACCOUNT_ID}/addresses/missing`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { label: 'x' },
    });
    const body = response.json();

    expect(response.statusCode).toBe(404);
    expect(body.error.code).toBe('SHIPPING_ADDRESS_NOT_FOUND');

    await server.close();
  });

  // ── DELETE /accounts/:accountId/addresses/:addressId ─────────────────────

  it('deletes address and returns 200 with id', async () => {
    const actor = buildActor();
    const addr = buildStoredAddress();
    const prisma = buildPrisma({ actor, accounts: [buildStoredAccount()], addresses: [addr] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'DELETE',
      url: `/accounts/${ACCOUNT_ID}/addresses/${ADDRESS_ID}`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.id).toBe(ADDRESS_ID);

    await server.close();
  });

  it('returns 404 on DELETE when address not found', async () => {
    const actor = buildActor();
    const prisma = buildPrisma({ actor, accounts: [buildStoredAccount()], addresses: [] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'DELETE',
      url: `/accounts/${ACCOUNT_ID}/addresses/missing`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });
    const body = response.json();

    expect(response.statusCode).toBe(404);
    expect(body.error.code).toBe('SHIPPING_ADDRESS_NOT_FOUND');

    await server.close();
  });
});

// ── Fixtures ──────────────────────────────────────────────────────────────

function validCreatePayload() {
  return {
    label: '서울 창고',
    country: 'KR',
    fullAddress: '서울특별시 강남구 테헤란로 123',
    isPrimary: false,
    defaultIncoterm: 'FOB' as Incoterm,
  };
}

function issueToken(userId: string, roles: Role[]): string {
  return issueAccessToken(
    { sub: userId, email: `${userId}@kody.test`, roles },
    'test-secret',
  ).token;
}

interface ActorInput {
  id?: string;
  roles?: Role[];
  status?: UserStatus;
}

function buildActor(input: ActorInput = {}) {
  const id = input.id ?? 'admin_1';
  const roles = input.roles ?? ['ADMIN'];
  const status: UserStatus = input.status ?? 'ACTIVE';
  return {
    id,
    employeeId: `${id}_employee`,
    email: `${id}@kody.test`,
    passwordHash: 'unused',
    displayName: `User ${id}`,
    profileImageUrl: null,
    status,
    failedLoginCount: 0,
    lockedUntil: null,
    lastLoginAt: null,
    createdAt: new Date('2026-05-07T00:00:00.000Z'),
    updatedAt: new Date('2026-05-07T00:00:00.000Z'),
    roles: roles.map((role) => ({ role })),
    employee: {
      id: `${id}_employee`,
      name: `Employee ${id}`,
      email: `${id}@kody.test`,
      phone: null,
      department: 'Ops',
      position: 'Manager',
      status: 'ACTIVE',
    },
  };
}

function buildStoredAccount(overrides: Partial<{ id: string }> = {}) {
  return {
    id: overrides.id ?? ACCOUNT_ID,
    name: 'Acme Co',
    representative: 'Jane Doe',
    primaryDepositor: 'Jane D',
    salesRepId: 'sales_rep_1',
    defaultDiscountRate: 0.1,
    depositSource: 'NONGHYUP',
    memo: null,
    createdAt: new Date('2026-05-07T00:00:00.000Z'),
    updatedAt: new Date('2026-05-07T00:00:00.000Z'),
  };
}

function buildStoredAddress(overrides: Partial<{
  id: string;
  accountId: string;
  label: string;
  country: string;
  fullAddress: string;
  isPrimary: boolean;
  defaultIncoterm: Incoterm | null;
}> = {}) {
  return {
    id: overrides.id ?? ADDRESS_ID,
    accountId: overrides.accountId ?? ACCOUNT_ID,
    label: overrides.label ?? '서울 창고',
    country: overrides.country ?? 'KR',
    fullAddress: overrides.fullAddress ?? '서울특별시 강남구 테헤란로 123',
    isPrimary: overrides.isPrimary ?? false,
    defaultIncoterm: overrides.defaultIncoterm !== undefined ? overrides.defaultIncoterm : 'FOB' as Incoterm,
    createdAt: new Date('2026-05-27T00:00:00.000Z'),
    updatedAt: new Date('2026-05-27T00:00:00.000Z'),
  };
}

interface PrismaInput {
  actor: ReturnType<typeof buildActor>;
  accounts?: ReturnType<typeof buildStoredAccount>[];
  addresses?: ReturnType<typeof buildStoredAddress>[];
  createdAddress?: ReturnType<typeof buildStoredAddress>;
  updatedAddress?: ReturnType<typeof buildStoredAddress>;
}

function buildPrisma(input: PrismaInput) {
  const accounts = input.accounts ?? [];
  const addresses = input.addresses ?? [];

  const shippingAddressMock = {
    create: vi.fn(async () => {
      if (!input.createdAddress) throw new Error('createdAddress not provided');
      return input.createdAddress;
    }),
    findUnique: vi.fn(async (args: { where: { id: string } }) => {
      return addresses.find((a) => a.id === args.where.id) ?? null;
    }),
    findMany: vi.fn(async () => {
      // return isPrimary first
      return [...addresses].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
    }),
    update: vi.fn(async () => {
      if (!input.updatedAddress) throw new Error('updatedAddress not provided');
      return input.updatedAddress;
    }),
    updateMany: vi.fn(async () => ({ count: 1 })),
    delete: vi.fn(async (args: { where: { id: string } }) => {
      const addr = addresses.find((a) => a.id === args.where.id);
      if (!addr) throw new Error('address not found in fixture');
      return addr;
    }),
  };

  return {
    user: {
      findUnique: vi.fn(async (args: { where: { id: string } }) => {
        if (args.where.id === input.actor.id) return input.actor;
        return null;
      }),
    },
    account: {
      findUnique: vi.fn(async (args: { where: { id: string } }) => {
        return accounts.find((a) => a.id === args.where.id) ?? null;
      }),
      findMany: vi.fn(async () => accounts),
      create: vi.fn(async () => { throw new Error('not used'); }),
      update: vi.fn(async () => { throw new Error('not used'); }),
    },
    shippingAddress: shippingAddressMock,
    refreshToken: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
    },
    actionLog: {
      create: vi.fn(async () => ({})),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $transaction: vi.fn(async (fn: any) => {
      return fn({ shippingAddress: shippingAddressMock });
    }),
  };
}
