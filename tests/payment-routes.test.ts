import { describe, expect, it, vi } from 'vitest';
import { issueAccessToken } from '@/domain/auth/tokens.js';
import type { Currency, DepositSource, PaymentType, Role, UserStatus } from '@/domain/shared/types.js';
import { buildTestServer as _buildTestServer } from './helpers.js';
import type { PrismaClient } from '@prisma/client';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildTestServer(prisma: any) {
  return _buildTestServer(prisma as Partial<PrismaClient>);
}

const ACCOUNT_ID = 'acc_1';
const PAYMENT_ID = 'pay_1';

describe('payment routes', () => {
  // ── POST /payments ─────────────────────────────────────────────────────────

  it('rejects unauthenticated POST as AUTHENTICATION_ERROR', async () => {
    const prisma = buildPrisma({ actor: buildActor() });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/payments',
      payload: validCreatePayload(),
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('AUTHENTICATION_ERROR');
    await server.close();
  });

  it('rejects SALES from POST /payments as AUTHORIZATION_ERROR', async () => {
    const actor = buildActor({ roles: ['SALES'] });
    const prisma = buildPrisma({ actor, accounts: [buildStoredAccount()] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/payments',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: validCreatePayload(),
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('AUTHORIZATION_ERROR');
    await server.close();
  });

  it('rejects OPERATIONS from POST /payments as AUTHORIZATION_ERROR', async () => {
    const actor = buildActor({ roles: ['OPERATIONS'] });
    const prisma = buildPrisma({ actor, accounts: [buildStoredAccount()] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/payments',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: validCreatePayload(),
    });
    expect(response.statusCode).toBe(403);
    await server.close();
  });

  it('allows FINANCE to POST /payments and returns 201', async () => {
    const actor = buildActor({ roles: ['FINANCE'] });
    const payment = buildStoredPayment();
    const prisma = buildPrisma({ actor, accounts: [buildStoredAccount()], createdPayment: payment });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/payments',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: validCreatePayload(),
    });
    const body = response.json();
    expect(response.statusCode).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.data.id).toBe(payment.id);
    await server.close();
  });

  it('returns 404 when account not found on POST', async () => {
    const actor = buildActor({ roles: ['FINANCE'] });
    const prisma = buildPrisma({ actor, accounts: [] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/payments',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: validCreatePayload(),
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('ACCOUNT_NOT_FOUND');
    await server.close();
  });

  it('returns 400 when required field missing on POST', async () => {
    const actor = buildActor({ roles: ['FINANCE'] });
    const prisma = buildPrisma({ actor, accounts: [buildStoredAccount()] });
    const server = buildTestServer(prisma);
    await server.ready();

    const { amount: _omit, ...withoutAmount } = validCreatePayload();
    const response = await server.inject({
      method: 'POST',
      url: '/payments',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: withoutAmount,
    });
    expect(response.statusCode).toBe(400);
    await server.close();
  });

  // ── GET /payments ──────────────────────────────────────────────────────────

  it('allows SALES to GET /payments', async () => {
    const actor = buildActor({ roles: ['SALES'] });
    const prisma = buildPrisma({ actor, payments: [buildStoredPayment()] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/payments',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });
    const body = response.json();
    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.items).toHaveLength(1);
    await server.close();
  });

  // ── GET /payments/:id ──────────────────────────────────────────────────────

  it('returns payment detail on GET /payments/:id', async () => {
    const actor = buildActor();
    const payment = buildStoredPayment();
    const prisma = buildPrisma({ actor, payments: [payment] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: `/payments/${PAYMENT_ID}`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });
    const body = response.json();
    expect(response.statusCode).toBe(200);
    expect(body.data.id).toBe(PAYMENT_ID);
    await server.close();
  });

  it('returns 404 on GET /payments/:id when not found', async () => {
    const actor = buildActor();
    const prisma = buildPrisma({ actor, payments: [] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/payments/missing',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('PAYMENT_NOT_FOUND');
    await server.close();
  });

  // ── PATCH /payments/:id ────────────────────────────────────────────────────

  it('rejects SALES from PATCH /payments/:id', async () => {
    const actor = buildActor({ roles: ['SALES'] });
    const payment = buildStoredPayment();
    const prisma = buildPrisma({ actor, payments: [payment] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'PATCH',
      url: `/payments/${PAYMENT_ID}`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { memo: 'updated' },
    });
    expect(response.statusCode).toBe(403);
    await server.close();
  });

  it('allows FINANCE to PATCH /payments/:id', async () => {
    const actor = buildActor({ roles: ['FINANCE'] });
    const payment = buildStoredPayment();
    const updated = buildStoredPayment({ memo: 'updated memo' });
    const prisma = buildPrisma({ actor, payments: [payment], updatedPayment: updated });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'PATCH',
      url: `/payments/${PAYMENT_ID}`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { memo: 'updated memo' },
    });
    const body = response.json();
    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    await server.close();
  });

  it('returns 404 on PATCH /payments/:id when not found', async () => {
    const actor = buildActor({ roles: ['FINANCE'] });
    const prisma = buildPrisma({ actor, payments: [] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'PATCH',
      url: '/payments/missing',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { memo: 'x' },
    });
    expect(response.statusCode).toBe(404);
    await server.close();
  });

  // ── DELETE /payments/:id ───────────────────────────────────────────────────

  it('rejects SALES from DELETE /payments/:id', async () => {
    const actor = buildActor({ roles: ['SALES'] });
    const payment = buildStoredPayment();
    const prisma = buildPrisma({ actor, payments: [payment] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'DELETE',
      url: `/payments/${PAYMENT_ID}`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });
    expect(response.statusCode).toBe(403);
    await server.close();
  });

  it('allows FINANCE to DELETE /payments/:id', async () => {
    const actor = buildActor({ roles: ['FINANCE'] });
    const payment = buildStoredPayment();
    const prisma = buildPrisma({ actor, payments: [payment] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'DELETE',
      url: `/payments/${PAYMENT_ID}`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });
    const body = response.json();
    expect(response.statusCode).toBe(200);
    expect(body.data.id).toBe(PAYMENT_ID);
    await server.close();
  });

  it('returns 404 on DELETE /payments/:id when not found', async () => {
    const actor = buildActor({ roles: ['FINANCE'] });
    const prisma = buildPrisma({ actor, payments: [] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'DELETE',
      url: '/payments/missing',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });
    expect(response.statusCode).toBe(404);
    await server.close();
  });

  // ── GET /accounts/:id/balance ─────────────────────────────────────────────

  it('allows SALES to GET /accounts/:id/balance', async () => {
    const actor = buildActor({ roles: ['SALES'] });
    const prisma = buildPrisma({
      actor,
      accounts: [buildStoredAccount()],
      payments: [buildStoredPayment()],
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: `/accounts/${ACCOUNT_ID}/balance`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });
    const body = response.json();
    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.accountId).toBe(ACCOUNT_ID);
    expect(body.data.balanceByCurrency).toBeDefined();
    await server.close();
  });

  it('returns 404 on GET /accounts/:id/balance when account not found', async () => {
    const actor = buildActor();
    const prisma = buildPrisma({ actor, accounts: [], payments: [] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/accounts/missing/balance',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });
    expect(response.statusCode).toBe(404);
    await server.close();
  });
});

// ── Fixtures ──────────────────────────────────────────────────────────────

function validCreatePayload() {
  return {
    date: '2026-05-27',
    accountId: ACCOUNT_ID,
    depositSource: 'NONGHYUP' as DepositSource,
    currency: 'KRW' as Currency,
    amount: '1000000.00',
    krwEquivalent: '1000000.00',
    type: 'DEPOSIT' as PaymentType,
  };
}

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

function buildStoredAccount() {
  return { id: ACCOUNT_ID };
}

function buildStoredPayment(overrides: Partial<{ id: string; memo: string | null }> = {}) {
  return {
    id: overrides.id ?? PAYMENT_ID,
    date: new Date('2026-05-27T00:00:00Z'),
    accountId: ACCOUNT_ID,
    depositSource: 'NONGHYUP' as DepositSource,
    currency: 'KRW' as Currency,
    amount: { toString: () => '1000000.00' },
    krwEquivalent: { toString: () => '1000000.00' },
    type: 'DEPOSIT' as PaymentType,
    depositorName: null,
    memo: overrides.memo !== undefined ? overrides.memo : null,
    createdAt: new Date('2026-05-27T00:00:00Z'),
  };
}

interface PrismaInput {
  actor: ReturnType<typeof buildActor>;
  accounts?: ReturnType<typeof buildStoredAccount>[];
  payments?: ReturnType<typeof buildStoredPayment>[];
  createdPayment?: ReturnType<typeof buildStoredPayment>;
  updatedPayment?: ReturnType<typeof buildStoredPayment>;
}

function buildPrisma(input: PrismaInput) {
  const accounts = input.accounts ?? [];
  const payments = input.payments ?? [];

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
    payment: {
      create: vi.fn(async () => {
        if (!input.createdPayment) throw new Error('createdPayment not provided');
        return input.createdPayment;
      }),
      findUnique: vi.fn(async (args: { where: { id: string } }) => {
        return payments.find((p) => p.id === args.where.id) ?? null;
      }),
      findMany: vi.fn(async (args: { take?: number }) => {
        const take = args.take ?? payments.length;
        return payments.slice(0, take);
      }),
      update: vi.fn(async () => input.updatedPayment ?? payments[0]),
      delete: vi.fn(async (args: { where: { id: string } }) => {
        const p = payments.find((x) => x.id === args.where.id);
        if (!p) throw new Error('payment not found in fixture');
        return p;
      }),
      aggregate: vi.fn(async () => ({
        _sum: { krwEquivalent: { toString: () => '0' }, amount: { toString: () => '0' } },
      })),
      groupBy: vi.fn(async () => []),
    },
    fxRate: {
      upsert: vi.fn(async () => ({
        id: 'fx_1', date: new Date(), currency: 'USD', rateToKRW: { toString: () => '1350.50' }, createdAt: new Date(),
      })),
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
