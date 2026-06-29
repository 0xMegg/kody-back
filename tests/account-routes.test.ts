import { describe, expect, it, vi } from 'vitest';
import { issueAccessToken } from '@/domain/auth/tokens.js';
import type { DepositSource, Role, UserStatus } from '@/domain/shared/types.js';
import { buildTestServer } from './helpers.js';

describe('account routes', () => {
  it('rejects requests without an authorization header as AUTHENTICATION_ERROR', async () => {
    const prisma = buildPrisma({ actor: buildActor() });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/accounts',
      payload: validCreatePayload(),
    });
    const body = response.json();

    expect(response.statusCode).toBe(401);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('AUTHENTICATION_ERROR');
    expect(prisma.account.create).not.toHaveBeenCalled();
    expect(prisma.actionLog.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('rejects WAREHOUSE from POST /accounts as AUTHORIZATION_ERROR', async () => {
    const actor = buildActor({ id: 'wh_1', roles: ['WAREHOUSE'] });
    const prisma = buildPrisma({ actor });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/accounts',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: validCreatePayload(),
    });
    const body = response.json();

    expect(response.statusCode).toBe(403);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('AUTHORIZATION_ERROR');
    expect(prisma.account.create).not.toHaveBeenCalled();
    expect(prisma.actionLog.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('rejects WAREHOUSE from PATCH /accounts/:id as AUTHORIZATION_ERROR', async () => {
    const actor = buildActor({ id: 'wh_1', roles: ['WAREHOUSE'] });
    const account = buildStoredAccount();
    const prisma = buildPrisma({ actor, accounts: [account] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'PATCH',
      url: `/accounts/${account.id}`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { name: 'updated' },
    });
    const body = response.json();

    expect(response.statusCode).toBe(403);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('AUTHORIZATION_ERROR');
    expect(prisma.account.update).not.toHaveBeenCalled();
    expect(prisma.actionLog.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('allows WAREHOUSE to GET /accounts (read access via existing matrix)', async () => {
    const actor = buildActor({ id: 'wh_1', roles: ['WAREHOUSE'] });
    const account = buildStoredAccount();
    const prisma = buildPrisma({ actor, accounts: [account] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/accounts',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0].id).toBe(account.id);

    await server.close();
  });

  it.each<[Role]>([['ADMIN'], ['SALES'], ['OPERATIONS'], ['FINANCE']])(
    'allows %s to create an account and writes ACCOUNT_CREATE',
    async (role) => {
      const actor = buildActor({ id: `${role.toLowerCase()}_1`, roles: [role] });
      const salesRep = buildSalesRep({ id: 'sales_rep_1', status: 'ACTIVE' });
      const created = buildStoredAccount({
        id: 'acc_1',
        salesRepId: salesRep.id,
        memo: 'first',
      });
      const prisma = buildPrisma({
        actor,
        salesReps: [salesRep],
        createdAccount: created,
      });
      const server = buildTestServer(prisma);
      await server.ready();

      const response = await server.inject({
        method: 'POST',
        url: '/accounts',
        headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
        payload: {
          name: created.name,
          representative: created.representative,
          primaryDepositorName: created.primaryDepositor,
          internalSalesRepUserId: salesRep.id,
          defaultDiscountRate: created.defaultDiscountRate,
          depositSource: created.depositSource,
          memo: created.memo,
        },
      });
      const body = response.json();

      expect(response.statusCode).toBe(201);
      expect(body.ok).toBe(true);
      expect(body.data).toMatchObject({
        id: created.id,
        name: created.name,
        representative: created.representative,
        primaryDepositorName: created.primaryDepositor,
        internalSalesRepUserId: salesRep.id,
        defaultDiscountRate: created.defaultDiscountRate,
        depositSource: created.depositSource,
        memo: created.memo,
      });

      expect(prisma.account.create).toHaveBeenCalledWith({
        data: {
          name: created.name,
          representative: created.representative,
          primaryDepositor: created.primaryDepositor,
          salesRepId: salesRep.id,
          defaultDiscountRate: created.defaultDiscountRate,
          depositSource: created.depositSource,
          memo: created.memo,
        },
      });

      expect(prisma.actionLog.create).toHaveBeenCalledTimes(1);
      expect(prisma.actionLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorUserId: actor.id,
          actionType: 'ACCOUNT_CREATE',
          targetType: 'Account',
          targetId: created.id,
          afterJson: {
            name: created.name,
            representative: created.representative,
            primaryDepositorName: created.primaryDepositor,
            internalSalesRepUserId: salesRep.id,
            defaultDiscountRate: created.defaultDiscountRate,
            depositSource: created.depositSource,
            memo: created.memo,
          },
        }),
      });

      await server.close();
    },
  );

  it('rejects POST /accounts with missing name as VALIDATION_ERROR', async () => {
    const actor = buildActor({ id: 'sales_1', roles: ['SALES'] });
    const prisma = buildPrisma({ actor });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/accounts',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { ...validCreatePayload(), name: '' },
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(prisma.account.create).not.toHaveBeenCalled();
    expect(prisma.actionLog.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('rejects POST /accounts with invalid depositSource as VALIDATION_ERROR', async () => {
    const actor = buildActor({ id: 'sales_1', roles: ['SALES'] });
    const prisma = buildPrisma({ actor });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/accounts',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { ...validCreatePayload(), depositSource: 'OTHER' },
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(prisma.account.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('rejects POST /accounts with defaultDiscountRate above 1 as VALIDATION_ERROR', async () => {
    const actor = buildActor({ id: 'sales_1', roles: ['SALES'] });
    const prisma = buildPrisma({ actor });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/accounts',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { ...validCreatePayload(), defaultDiscountRate: 1.5 },
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(prisma.account.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('rejects POST /accounts with defaultDiscountRate below 0 as VALIDATION_ERROR', async () => {
    const actor = buildActor({ id: 'sales_1', roles: ['SALES'] });
    const prisma = buildPrisma({ actor });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/accounts',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { ...validCreatePayload(), defaultDiscountRate: -0.1 },
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(prisma.account.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('rejects POST /accounts when internalSalesRepUserId does not exist as SALES_REP_NOT_FOUND', async () => {
    const actor = buildActor({ id: 'sales_1', roles: ['SALES'] });
    const prisma = buildPrisma({ actor, salesReps: [] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/accounts',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { ...validCreatePayload(), internalSalesRepUserId: 'missing_user' },
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('SALES_REP_NOT_FOUND');
    expect(prisma.account.create).not.toHaveBeenCalled();
    expect(prisma.actionLog.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('rejects POST /accounts when internalSalesRepUserId references an inactive user as SALES_REP_INACTIVE', async () => {
    const actor = buildActor({ id: 'sales_1', roles: ['SALES'] });
    const salesRep = buildSalesRep({ id: 'sales_rep_inactive', status: 'INACTIVE' });
    const prisma = buildPrisma({ actor, salesReps: [salesRep] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/accounts',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { ...validCreatePayload(), internalSalesRepUserId: salesRep.id },
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('SALES_REP_INACTIVE');
    expect(prisma.account.create).not.toHaveBeenCalled();
    expect(prisma.actionLog.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('allows POST /accounts when internalSalesRepUserId references any ACTIVE user (no role restriction)', async () => {
    const actor = buildActor({ id: 'sales_1', roles: ['SALES'] });
    const salesRep = buildSalesRep({ id: 'warehouse_user', status: 'ACTIVE' });
    const created = buildStoredAccount({ salesRepId: salesRep.id });
    const prisma = buildPrisma({
      actor,
      salesReps: [salesRep],
      createdAccount: created,
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/accounts',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { ...validCreatePayload(), internalSalesRepUserId: salesRep.id },
    });
    const body = response.json();

    expect(response.statusCode).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.data.internalSalesRepUserId).toBe(salesRep.id);

    await server.close();
  });

  it('returns ACCOUNT_NOT_FOUND for GET /accounts/:id when the account does not exist', async () => {
    const actor = buildActor({ id: 'sales_1', roles: ['SALES'] });
    const prisma = buildPrisma({ actor, accounts: [] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/accounts/missing',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });
    const body = response.json();

    expect(response.statusCode).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('ACCOUNT_NOT_FOUND');

    await server.close();
  });

  it('returns ACCOUNT_NOT_FOUND for PATCH /accounts/:id when the account does not exist', async () => {
    const actor = buildActor({ id: 'sales_1', roles: ['SALES'] });
    const prisma = buildPrisma({ actor, accounts: [] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'PATCH',
      url: '/accounts/missing',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { name: 'new name' },
    });
    const body = response.json();

    expect(response.statusCode).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('ACCOUNT_NOT_FOUND');
    expect(prisma.account.update).not.toHaveBeenCalled();
    expect(prisma.actionLog.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('returns one account for GET /accounts/:id', async () => {
    const actor = buildActor({ id: 'sales_1', roles: ['SALES'] });
    const account = buildStoredAccount();
    const prisma = buildPrisma({ actor, accounts: [account] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: `/accounts/${account.id}`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data).toMatchObject({
      id: account.id,
      name: account.name,
      primaryDepositorName: account.primaryDepositor,
      internalSalesRepUserId: account.salesRepId,
      memo: account.memo,
    });

    await server.close();
  });

  it('lists accounts with cursor pagination and forwards q filter to prisma', async () => {
    const actor = buildActor({ id: 'sales_1', roles: ['SALES'] });
    const account1 = buildStoredAccount({ id: 'acc_1', name: 'Alpha' });
    const account2 = buildStoredAccount({ id: 'acc_2', name: 'Alpaca' });
    const account3 = buildStoredAccount({ id: 'acc_3', name: 'Alpha Inc' });
    const prisma = buildPrisma({
      actor,
      accounts: [account1, account2, account3],
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/accounts?limit=2&q=alp',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.items).toHaveLength(2);
    expect(body.data.nextCursor).toBe(account2.id);
    expect(prisma.account.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { name: { contains: 'alp', mode: 'insensitive' } },
            { representative: { contains: 'alp', mode: 'insensitive' } },
          ],
        },
        take: 3,
      }),
    );

    await server.close();
  });

  it('returns nextCursor null when fewer items than limit are returned', async () => {
    const actor = buildActor({ id: 'sales_1', roles: ['SALES'] });
    const account = buildStoredAccount();
    const prisma = buildPrisma({ actor, accounts: [account] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/accounts?limit=10',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.items).toHaveLength(1);
    expect(body.data.nextCursor).toBeNull();

    await server.close();
  });

  it('applies cursor to prisma findMany when provided', async () => {
    const actor = buildActor({ id: 'sales_1', roles: ['SALES'] });
    const account = buildStoredAccount();
    const prisma = buildPrisma({ actor, accounts: [account] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/accounts?cursor=acc_prev',
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });

    expect(response.statusCode).toBe(200);
    expect(prisma.account.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 1,
        cursor: { id: 'acc_prev' },
      }),
    );

    await server.close();
  });

  it('updates account fields and writes ACCOUNT_UPDATE with before/after of changed fields', async () => {
    const actor = buildActor({ id: 'admin_1', roles: ['ADMIN'] });
    const account = buildStoredAccount({
      id: 'acc_1',
      name: 'Old Name',
      representative: 'Old Rep',
      memo: 'old memo',
    });
    const updated = {
      ...account,
      name: 'New Name',
      memo: 'new memo',
    };
    const prisma = buildPrisma({
      actor,
      accounts: [account],
      updatedAccount: updated,
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'PATCH',
      url: `/accounts/${account.id}`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: {
        name: 'New Name',
        representative: 'Old Rep',
        memo: 'new memo',
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.name).toBe('New Name');
    expect(body.data.memo).toBe('new memo');

    expect(prisma.account.update).toHaveBeenCalledWith({
      where: { id: account.id },
      data: {
        name: 'New Name',
        memo: 'new memo',
      },
    });

    expect(prisma.actionLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.actionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: actor.id,
        actionType: 'ACCOUNT_UPDATE',
        targetType: 'Account',
        targetId: account.id,
        beforeJson: { name: 'Old Name', memo: 'old memo' },
        afterJson: { name: 'New Name', memo: 'new memo' },
      }),
    });

    await server.close();
  });

  it('does not write ACCOUNT_UPDATE when PATCH is a no-op (every field matches current)', async () => {
    const actor = buildActor({ id: 'admin_1', roles: ['ADMIN'] });
    const account = buildStoredAccount();
    const prisma = buildPrisma({ actor, accounts: [account] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'PATCH',
      url: `/accounts/${account.id}`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: {
        name: account.name,
        representative: account.representative,
        primaryDepositorName: account.primaryDepositor,
        internalSalesRepUserId: account.salesRepId,
        defaultDiscountRate: account.defaultDiscountRate,
        depositSource: account.depositSource,
        memo: account.memo,
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.id).toBe(account.id);
    expect(prisma.account.update).not.toHaveBeenCalled();
    expect(prisma.actionLog.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('does not write ACCOUNT_UPDATE when PATCH body is empty', async () => {
    const actor = buildActor({ id: 'admin_1', roles: ['ADMIN'] });
    const account = buildStoredAccount();
    const prisma = buildPrisma({ actor, accounts: [account] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'PATCH',
      url: `/accounts/${account.id}`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: {},
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(prisma.account.update).not.toHaveBeenCalled();
    expect(prisma.actionLog.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('rejects PATCH when changing internalSalesRepUserId to an inactive user', async () => {
    const actor = buildActor({ id: 'admin_1', roles: ['ADMIN'] });
    const account = buildStoredAccount();
    const inactiveRep = buildSalesRep({ id: 'rep_inactive', status: 'INACTIVE' });
    const prisma = buildPrisma({
      actor,
      accounts: [account],
      salesReps: [inactiveRep],
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'PATCH',
      url: `/accounts/${account.id}`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { internalSalesRepUserId: inactiveRep.id },
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('SALES_REP_INACTIVE');
    expect(prisma.account.update).not.toHaveBeenCalled();
    expect(prisma.actionLog.create).not.toHaveBeenCalled();

    await server.close();
  });

  it('allows clearing memo via PATCH with explicit null', async () => {
    const actor = buildActor({ id: 'admin_1', roles: ['ADMIN'] });
    const account = buildStoredAccount({ memo: 'old' });
    const prisma = buildPrisma({
      actor,
      accounts: [account],
      updatedAccount: { ...account, memo: null },
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'PATCH',
      url: `/accounts/${account.id}`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: { memo: null },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.memo).toBeNull();
    expect(prisma.account.update).toHaveBeenCalledWith({
      where: { id: account.id },
      data: { memo: null },
    });
    expect(prisma.actionLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.actionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actionType: 'ACCOUNT_UPDATE',
        beforeJson: { memo: 'old' },
        afterJson: { memo: null },
      }),
    });

    await server.close();
  });

  it('returns customer detail with recent order product context', async () => {
    const actor = buildActor({ id: 'sales_1', roles: ['SALES'] });
    const account = buildStoredAccount({ id: 'acc_customer' });
    const order = buildStoredOrder({ accountId: account.id });
    const prisma = buildPrisma({ actor, accounts: [account], orders: [order] });
    const server = buildTestServer(prisma);
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: `/accounts/${account.id}/customer-detail`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.account.id).toBe(account.id);
    expect(body.data.recentOrders).toHaveLength(1);
    expect(body.data.recentOrders[0]).toMatchObject({
      id: order.id,
      total: '116.00',
      items: [
        {
          kodyProductId: 'prod_1',
          name: 'KODY Album',
          category: 'ALBUM',
          categoryArtist: 'ILLIT',
          categoryArtistDetail: 'GIRL GROUP',
          categoryType: null,
          categoryTypeDetail: 'luckydraw',
          categoryProductType: null,
          categoryProductTypeDetail: null,
          categoryProductGroup: null,
          categoryProductGroupDetail: null,
          categoryArtistCandidates: ['ILLIT'],
          categoryArtistDetailCandidates: ['GIRL GROUP'],
          categoryTypeCandidates: [],
          categoryTypeDetailCandidates: ['luckydraw'],
          categoryProjectionMeta: {
            sourceCategoryCodes: ['CATE70', 'CATE65'],
            conflicts: [],
            reviewReasons: [],
            mappedCodes: [],
          },
          categoryReviewStatus: 'MAPPED',
          sourceCategoryCodes: ['CATE70', 'CATE65'],
        },
      ],
    });
    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { accountId: account.id },
        take: 10,
      }),
    );
    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          items: expect.objectContaining({
            select: expect.objectContaining({
              product: expect.objectContaining({
                select: expect.objectContaining({
                  categoryArtist: true,
                  categoryArtistDetail: true,
                  categoryType: true,
                  categoryTypeDetail: true,
                  categoryArtistCandidates: true,
                  categoryArtistDetailCandidates: true,
                  categoryTypeCandidates: true,
                  categoryTypeDetailCandidates: true,
                  categoryProjectionMeta: true,
                }),
              }),
            }),
          }),
        }),
      }),
    );
    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          items: expect.objectContaining({
            select: expect.objectContaining({
              product: expect.objectContaining({
                select: expect.not.objectContaining({
                  categoryProductType: true,
                  categoryProductTypeDetail: true,
                  categoryProductGroup: true,
                  categoryProductGroupDetail: true,
                }),
              }),
            }),
          }),
        }),
      }),
    );

    await server.close();
  });

  it('manages shipping addresses and keeps a single primary address', async () => {
    const actor = buildActor({ id: 'ops_1', roles: ['OPERATIONS'] });
    const account = buildStoredAccount({ id: 'acc_ship' });
    const address = buildStoredShippingAddress({ accountId: account.id });
    const createdAddress = buildStoredShippingAddress({
      id: 'addr_created',
      accountId: account.id,
      label: 'Osaka warehouse',
      isPrimary: true,
      defaultIncoterm: 'FOB',
    });
    const prisma = buildPrisma({
      actor,
      accounts: [account],
      shippingAddresses: [address],
      createdShippingAddress: createdAddress,
    });
    const server = buildTestServer(prisma);
    await server.ready();

    const listResponse = await server.inject({
      method: 'GET',
      url: `/accounts/${account.id}/addresses`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().data).toMatchObject([
      { id: address.id, accountId: account.id, label: address.label },
    ]);

    const createResponse = await server.inject({
      method: 'POST',
      url: `/accounts/${account.id}/addresses`,
      headers: { authorization: `Bearer ${issueToken(actor.id, actor.roles)}` },
      payload: {
        label: 'Osaka warehouse',
        country: 'JP',
        fullAddress: 'Osaka test address',
        isPrimary: true,
        defaultIncoterm: 'FOB',
      },
    });
    expect(createResponse.statusCode).toBe(201);
    expect(createResponse.json().data).toMatchObject({
      id: createdAddress.id,
      isPrimary: true,
      defaultIncoterm: 'FOB',
    });
    expect(prisma.shippingAddress.updateMany).toHaveBeenCalledWith({
      where: { accountId: account.id, isPrimary: true },
      data: { isPrimary: false },
    });

    await server.close();
  });
});

function validCreatePayload() {
  return {
    name: 'Acme Co',
    representative: 'Jane Doe',
    primaryDepositorName: 'Jane D',
    internalSalesRepUserId: 'sales_rep_1',
    defaultDiscountRate: 0.1,
    depositSource: 'NONGHYUP' as DepositSource,
    memo: 'first',
  };
}

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

function buildSalesRep(input: { id: string; status: UserStatus }) {
  return {
    id: input.id,
    status: input.status,
  };
}

function buildStoredAccount(overrides: Partial<{
  id: string;
  name: string;
  representative: string;
  primaryDepositor: string;
  salesRepId: string;
  defaultDiscountRate: number;
  depositSource: DepositSource;
  memo: string | null;
}> = {}) {
  return {
    id: overrides.id ?? 'acc_default',
    name: overrides.name ?? 'Acme Co',
    representative: overrides.representative ?? 'Jane Doe',
    primaryDepositor: overrides.primaryDepositor ?? 'Jane D',
    salesRepId: overrides.salesRepId ?? 'sales_rep_1',
    defaultDiscountRate:
      overrides.defaultDiscountRate ?? 0.1,
    depositSource: overrides.depositSource ?? ('NONGHYUP' as DepositSource),
    memo: overrides.memo === undefined ? 'first' : overrides.memo,
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-12T00:00:00.000Z'),
  };
}

function buildStoredOrder(overrides: Partial<{ id: string; accountId: string }> = {}) {
  return {
    id: overrides.id ?? 'ord_1',
    accountId: overrides.accountId ?? 'acc_default',
    orderDate: new Date('2026-05-20T00:00:00.000Z'),
    status: 'CONFIRMED',
    currency: 'USD',
    shippingFee: '10.00',
    remittanceFee: '6.00',
    items: [
      {
        subtotal: '100.00',
        product: {
          id: 'prod_1',
          name: 'KODY Album',
          category: 'ALBUM',
          categoryMappingSource: 'EXACT',
          categoryReviewStatus: 'MAPPED',
          sourceCategoryCodes: ['CATE70', 'CATE65'],
          categoryArtist: 'ILLIT',
          categoryArtistDetail: 'GIRL GROUP',
          categoryType: null,
          categoryTypeDetail: 'luckydraw',
          categoryProductType: null,
          categoryProductTypeDetail: null,
          categoryProductGroup: null,
          categoryProductGroupDetail: null,
          categoryArtistCandidates: ['ILLIT'],
          categoryArtistDetailCandidates: ['GIRL GROUP'],
          categoryTypeCandidates: [],
          categoryTypeDetailCandidates: ['luckydraw'],
          categoryProjectionMeta: {
            sourceCategoryCodes: ['CATE70', 'CATE65'],
            conflicts: [],
            reviewReasons: [],
            mappedCodes: [],
          },
          thumbnailUrl: null,
        },
      },
    ],
  };
}

function buildStoredShippingAddress(overrides: Partial<{
  id: string;
  accountId: string;
  label: string;
  country: string;
  fullAddress: string;
  isPrimary: boolean;
  defaultIncoterm: 'EXW' | 'FOB' | 'CIF' | 'DDP' | 'DAP' | null;
}> = {}) {
  return {
    id: overrides.id ?? 'addr_1',
    accountId: overrides.accountId ?? 'acc_default',
    label: overrides.label ?? 'Main warehouse',
    country: overrides.country ?? 'KR',
    fullAddress: overrides.fullAddress ?? 'Seoul test address',
    isPrimary: overrides.isPrimary ?? false,
    defaultIncoterm: overrides.defaultIncoterm === undefined ? 'DDP' : overrides.defaultIncoterm,
    createdAt: new Date('2026-05-13T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
  };
}

interface PrismaInput {
  actor: ReturnType<typeof buildActor>;
  accounts?: ReturnType<typeof buildStoredAccount>[];
  salesReps?: ReturnType<typeof buildSalesRep>[];
  orders?: ReturnType<typeof buildStoredOrder>[];
  shippingAddresses?: ReturnType<typeof buildStoredShippingAddress>[];
  createdAccount?: ReturnType<typeof buildStoredAccount>;
  updatedAccount?: ReturnType<typeof buildStoredAccount>;
  createdShippingAddress?: ReturnType<typeof buildStoredShippingAddress>;
  updatedShippingAddress?: ReturnType<typeof buildStoredShippingAddress>;
}

function buildPrisma(input: PrismaInput) {
  const accounts = input.accounts ?? [];
  const salesReps = input.salesReps ?? [
    buildSalesRep({ id: 'sales_rep_1', status: 'ACTIVE' }),
  ];
  const orders = input.orders ?? [];
  const shippingAddresses = input.shippingAddresses ?? [];

  const prismaCore = {
    user: {
      findUnique: vi.fn(async (args: { where: { id: string } }) => {
        if (args.where.id === input.actor.id) {
          return input.actor;
        }
        const rep = salesReps.find((r) => r.id === args.where.id);
        return rep ?? null;
      }),
    },
    account: {
      create: vi.fn(async () => {
        if (!input.createdAccount) {
          throw new Error('createdAccount not provided to test fixture');
        }
        return input.createdAccount;
      }),
      findUnique: vi.fn(async (args: { where: { id: string } }) => {
        return accounts.find((a) => a.id === args.where.id) ?? null;
      }),
      findMany: vi.fn(async (args: { take: number; cursor?: { id: string } }) => {
        return accounts.slice(0, args.take);
      }),
      update: vi.fn(async () => input.updatedAccount ?? accounts[0]),
    },
    order: {
      findMany: vi.fn(async (args: { where: { accountId: string }; take: number }) => {
        return orders.filter((order) => order.accountId === args.where.accountId).slice(0, args.take);
      }),
    },
    shippingAddress: {
      create: vi.fn(async () => {
        if (!input.createdShippingAddress) {
          throw new Error('createdShippingAddress not provided to test fixture');
        }
        return input.createdShippingAddress;
      }),
      findUnique: vi.fn(async (args: { where: { id: string } }) => {
        return shippingAddresses.find((address) => address.id === args.where.id) ?? null;
      }),
      findMany: vi.fn(async (args: { where: { accountId: string } }) => {
        return shippingAddresses.filter((address) => address.accountId === args.where.accountId);
      }),
      update: vi.fn(async () => input.updatedShippingAddress ?? shippingAddresses[0]),
      updateMany: vi.fn(async () => ({ count: 1 })),
      delete: vi.fn(async (args: { where: { id: string } }) => {
        const address = shippingAddresses.find((item) => item.id === args.where.id);
        if (!address) {
          throw new Error('shipping address not found in fixture');
        }
        return address;
      }),
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

  const prisma = {
    ...prismaCore,
    $transaction: vi.fn(async <R>(fn: (tx: typeof prismaCore) => Promise<R>) => fn(prismaCore)),
  };

  return prisma;
}
