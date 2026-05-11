import { DomainRuleError } from '@/domain/shared/errors.js';
import type { DepositSource, UserStatus } from '@/domain/shared/types.js';
import type { ActionLogWriter } from '@/application/shared/action-log-writer.js';

const DEPOSIT_SOURCES: readonly DepositSource[] = ['NONGHYUP', 'HANA', 'PAYPAL', 'PAYONEER'];

const DEFAULT_LIST_LIMIT = 20;
const MIN_LIST_LIMIT = 1;
const MAX_LIST_LIMIT = 100;

export interface AccountSummary {
  id: string;
  name: string;
  representative: string;
  primaryDepositorName: string;
  internalSalesRepUserId: string;
  defaultDiscountRate: number;
  depositSource: DepositSource;
  memo: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAccountInput {
  actorUserId: string;
  name: string;
  representative: string;
  primaryDepositorName: string;
  internalSalesRepUserId: string;
  defaultDiscountRate?: number;
  depositSource: DepositSource;
  memo?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface ListAccountsInput {
  limit?: number;
  cursor?: string;
  q?: string;
}

export interface ListAccountsResult {
  items: AccountSummary[];
  nextCursor: string | null;
}

export interface UpdateAccountInput {
  actorUserId: string;
  accountId: string;
  name?: string;
  representative?: string;
  primaryDepositorName?: string;
  internalSalesRepUserId?: string;
  defaultDiscountRate?: number;
  depositSource?: DepositSource;
  memo?: string | null;
  ipAddress?: string;
  userAgent?: string;
}

interface StoredAccount {
  id: string;
  name: string;
  representative: string;
  primaryDepositor: string;
  salesRepId: string;
  defaultDiscountRate: number;
  depositSource: DepositSource;
  memo: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface StoredUserLite {
  id: string;
  status: UserStatus;
}

interface AccountRepository {
  account: {
    create(args: { data: Record<string, unknown> }): Promise<StoredAccount>;
    findUnique(args: { where: { id: string } }): Promise<StoredAccount | null>;
    findMany(args: {
      where?: Record<string, unknown>;
      orderBy: { createdAt: 'asc' | 'desc' } | Array<Record<string, 'asc' | 'desc'>>;
      take: number;
      skip?: number;
      cursor?: { id: string };
    }): Promise<StoredAccount[]>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<StoredAccount>;
  };
  user: {
    findUnique(args: { where: { id: string } }): Promise<StoredUserLite | null>;
  };
}

export class AccountService {
  constructor(
    private readonly repository: AccountRepository,
    private readonly actionLogWriter: ActionLogWriter,
  ) {}

  async createAccount(input: CreateAccountInput): Promise<AccountSummary> {
    const name = normalizeRequiredString(input.name, 'name');
    const representative = normalizeRequiredString(input.representative, 'representative');
    const primaryDepositorName = normalizeRequiredString(
      input.primaryDepositorName,
      'primaryDepositorName',
    );
    const internalSalesRepUserId = normalizeRequiredString(
      input.internalSalesRepUserId,
      'internalSalesRepUserId',
    );
    const depositSource = normalizeDepositSource(input.depositSource);
    const defaultDiscountRate = normalizeDiscountRate(input.defaultDiscountRate ?? 0);
    const memo = normalizeOptionalMemo(input.memo);

    await this.assertSalesRepIsActive(internalSalesRepUserId);

    const created = await this.repository.account.create({
      data: {
        name,
        representative,
        primaryDepositor: primaryDepositorName,
        salesRepId: internalSalesRepUserId,
        defaultDiscountRate,
        depositSource,
        ...(memo !== undefined ? { memo } : {}),
      },
    });

    await this.actionLogWriter.write({
      actorUserId: input.actorUserId,
      actionType: 'ACCOUNT_CREATE',
      targetType: 'Account',
      targetId: created.id,
      afterJson: toAccountAuditPayload(created),
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    return toAccountSummary(created);
  }

  async getAccount(accountId: string): Promise<AccountSummary> {
    const account = await this.findAccount(accountId);
    return toAccountSummary(account);
  }

  async listAccounts(input: ListAccountsInput): Promise<ListAccountsResult> {
    const limit = normalizeListLimit(input.limit);
    const cursor = normalizeOptionalString(input.cursor);
    const q = normalizeOptionalString(input.q);

    const where: Record<string, unknown> = {};

    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { representative: { contains: q, mode: 'insensitive' } },
      ];
    }

    const items = await this.repository.account.findMany({
      ...(Object.keys(where).length > 0 ? { where } : {}),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });

    const hasMore = items.length > limit;
    const sliced = hasMore ? items.slice(0, limit) : items;
    const nextCursor = hasMore ? sliced[sliced.length - 1].id : null;

    return {
      items: sliced.map(toAccountSummary),
      nextCursor,
    };
  }

  async updateAccount(input: UpdateAccountInput): Promise<AccountSummary> {
    const accountId = normalizeRequiredString(input.accountId, 'accountId');
    const current = await this.findAccount(accountId);

    const changes: Record<string, unknown> = {};
    const beforeJson: Record<string, unknown> = {};
    const afterJson: Record<string, unknown> = {};

    if (input.name !== undefined) {
      const name = normalizeRequiredString(input.name, 'name');
      if (name !== current.name) {
        changes.name = name;
        beforeJson.name = current.name;
        afterJson.name = name;
      }
    }

    if (input.representative !== undefined) {
      const representative = normalizeRequiredString(input.representative, 'representative');
      if (representative !== current.representative) {
        changes.representative = representative;
        beforeJson.representative = current.representative;
        afterJson.representative = representative;
      }
    }

    if (input.primaryDepositorName !== undefined) {
      const primaryDepositor = normalizeRequiredString(
        input.primaryDepositorName,
        'primaryDepositorName',
      );
      if (primaryDepositor !== current.primaryDepositor) {
        changes.primaryDepositor = primaryDepositor;
        beforeJson.primaryDepositorName = current.primaryDepositor;
        afterJson.primaryDepositorName = primaryDepositor;
      }
    }

    if (input.internalSalesRepUserId !== undefined) {
      const salesRepId = normalizeRequiredString(
        input.internalSalesRepUserId,
        'internalSalesRepUserId',
      );
      if (salesRepId !== current.salesRepId) {
        await this.assertSalesRepIsActive(salesRepId);
        changes.salesRepId = salesRepId;
        beforeJson.internalSalesRepUserId = current.salesRepId;
        afterJson.internalSalesRepUserId = salesRepId;
      }
    }

    if (input.defaultDiscountRate !== undefined) {
      const defaultDiscountRate = normalizeDiscountRate(input.defaultDiscountRate);
      if (defaultDiscountRate !== current.defaultDiscountRate) {
        changes.defaultDiscountRate = defaultDiscountRate;
        beforeJson.defaultDiscountRate = current.defaultDiscountRate;
        afterJson.defaultDiscountRate = defaultDiscountRate;
      }
    }

    if (input.depositSource !== undefined) {
      const depositSource = normalizeDepositSource(input.depositSource);
      if (depositSource !== current.depositSource) {
        changes.depositSource = depositSource;
        beforeJson.depositSource = current.depositSource;
        afterJson.depositSource = depositSource;
      }
    }

    if (input.memo !== undefined) {
      const memo = input.memo === null ? null : normalizeOptionalMemo(input.memo) ?? null;
      if (memo !== current.memo) {
        changes.memo = memo;
        beforeJson.memo = current.memo;
        afterJson.memo = memo;
      }
    }

    if (Object.keys(changes).length === 0) {
      return toAccountSummary(current);
    }

    const updated = await this.repository.account.update({
      where: { id: accountId },
      data: changes,
    });

    await this.actionLogWriter.write({
      actorUserId: input.actorUserId,
      actionType: 'ACCOUNT_UPDATE',
      targetType: 'Account',
      targetId: accountId,
      beforeJson,
      afterJson,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    return toAccountSummary(updated);
  }

  private async findAccount(accountId: string): Promise<StoredAccount> {
    const account = await this.repository.account.findUnique({ where: { id: accountId } });

    if (!account) {
      throw new DomainRuleError('ACCOUNT_NOT_FOUND', 'Account not found', 404);
    }

    return account;
  }

  private async assertSalesRepIsActive(userId: string): Promise<void> {
    const user = await this.repository.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new DomainRuleError(
        'SALES_REP_NOT_FOUND',
        'internalSalesRepUserId does not reference an existing user',
        400,
      );
    }

    if (user.status !== 'ACTIVE') {
      throw new DomainRuleError(
        'SALES_REP_INACTIVE',
        'internalSalesRepUserId does not reference an active user',
        400,
      );
    }
  }
}

function normalizeRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new DomainRuleError('VALIDATION_ERROR', `${field} is required`, 400);
  }

  return value.trim();
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function normalizeOptionalMemo(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new DomainRuleError('VALIDATION_ERROR', 'memo must be a string', 400);
  }

  return value;
}

function normalizeDepositSource(value: unknown): DepositSource {
  if (typeof value !== 'string' || !DEPOSIT_SOURCES.includes(value as DepositSource)) {
    throw new DomainRuleError(
      'VALIDATION_ERROR',
      'depositSource must be NONGHYUP, HANA, PAYPAL, or PAYONEER',
      400,
    );
  }

  return value as DepositSource;
}

function normalizeDiscountRate(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new DomainRuleError(
      'VALIDATION_ERROR',
      'defaultDiscountRate must be a number between 0 and 1',
      400,
    );
  }

  if (value < 0 || value > 1) {
    throw new DomainRuleError(
      'VALIDATION_ERROR',
      'defaultDiscountRate must be between 0 and 1',
      400,
    );
  }

  return value;
}

function normalizeListLimit(value: unknown): number {
  if (value === undefined) {
    return DEFAULT_LIST_LIMIT;
  }

  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new DomainRuleError(
      'VALIDATION_ERROR',
      `limit must be an integer between ${MIN_LIST_LIMIT} and ${MAX_LIST_LIMIT}`,
      400,
    );
  }

  if (value < MIN_LIST_LIMIT || value > MAX_LIST_LIMIT) {
    throw new DomainRuleError(
      'VALIDATION_ERROR',
      `limit must be between ${MIN_LIST_LIMIT} and ${MAX_LIST_LIMIT}`,
      400,
    );
  }

  return value;
}

function toAccountSummary(account: StoredAccount): AccountSummary {
  return {
    id: account.id,
    name: account.name,
    representative: account.representative,
    primaryDepositorName: account.primaryDepositor,
    internalSalesRepUserId: account.salesRepId,
    defaultDiscountRate: account.defaultDiscountRate,
    depositSource: account.depositSource,
    memo: account.memo,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

function toAccountAuditPayload(account: StoredAccount): Record<string, unknown> {
  return {
    name: account.name,
    representative: account.representative,
    primaryDepositorName: account.primaryDepositor,
    internalSalesRepUserId: account.salesRepId,
    defaultDiscountRate: account.defaultDiscountRate,
    depositSource: account.depositSource,
    memo: account.memo,
  };
}
