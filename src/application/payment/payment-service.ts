import { DomainRuleError } from '@/domain/shared/errors.js';
import type { Currency, DepositSource, PaymentType } from '@/domain/shared/types.js';
import type { ActionLogWriter } from '@/application/shared/action-log-writer.js';

const CURRENCIES: readonly Currency[] = ['KRW', 'USD', 'EUR', 'RUB'];
const PAYMENT_TYPES: readonly PaymentType[] = ['DEPOSIT', 'WITHDRAWAL', 'ADJUSTMENT'];
const DEPOSIT_SOURCES: readonly DepositSource[] = ['NONGHYUP', 'HANA', 'PAYPAL', 'PAYONEER'];

const DEFAULT_LIST_LIMIT = 20;
const MIN_LIST_LIMIT = 1;
const MAX_LIST_LIMIT = 100;

const AMOUNT_PATTERN = /^-?\d+(\.\d+)?$/;
const FX_RATE_PATTERN = /^-?\d+(\.\d+)?$/;

export type { Currency, DepositSource, PaymentType };

export interface PaymentSummary {
  id: string;
  date: Date;
  accountId: string;
  depositSource: DepositSource;
  currency: Currency;
  amount: string;
  krwEquivalent: string;
  type: PaymentType;
  depositorName: string | null;
  memo: string | null;
  createdAt: Date;
}

export interface FxRateSummary {
  id: string;
  date: Date;
  currency: Currency;
  rateToKRW: string;
  createdAt: Date;
}

export interface AccountBalanceCurrencyBucket {
  totalDeposit: string;
  totalWithdrawal: string;
  balance: string;
}

export interface AccountBalanceSummary {
  accountId: string;
  balanceByCurrency: Record<Currency, AccountBalanceCurrencyBucket>;
  krwEquivalentTotal: string;
}

export interface CreatePaymentInput {
  actorUserId: string;
  date: Date;
  accountId: string;
  depositSource: DepositSource;
  currency: Currency;
  amount: string;
  krwEquivalent: string;
  type?: PaymentType;
  depositorName?: string;
  memo?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface ListPaymentsInput {
  accountId?: string;
  currency?: Currency;
  dateFrom?: Date;
  dateTo?: Date;
  limit?: number;
  cursor?: string;
}

export interface ListPaymentsResult {
  items: PaymentSummary[];
  nextCursor: string | null;
}

export interface UpdatePaymentInput {
  actorUserId: string;
  paymentId: string;
  date?: Date;
  depositSource?: DepositSource;
  currency?: Currency;
  amount?: string;
  krwEquivalent?: string;
  type?: PaymentType;
  depositorName?: string | null;
  memo?: string | null;
  ipAddress?: string;
  userAgent?: string;
}

export interface DeletePaymentInput {
  actorUserId: string;
  paymentId: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface UpsertFxRateInput {
  date: Date;
  currency: Currency;
  rateToKRW: string;
}

export interface ListFxRatesInput {
  date?: Date;
  currency?: Currency;
}

interface DecimalLike {
  toString(): string;
}

interface StoredPayment {
  id: string;
  date: Date;
  accountId: string;
  depositSource: DepositSource;
  currency: Currency;
  amount: DecimalLike;
  krwEquivalent: DecimalLike;
  type: PaymentType;
  depositorName: string | null;
  memo: string | null;
  createdAt: Date;
}

interface StoredFxRate {
  id: string;
  date: Date;
  currency: Currency;
  rateToKRW: DecimalLike;
  createdAt: Date;
}

interface PaymentRepository {
  account: {
    findUnique(args: { where: { id: string } }): Promise<{ id: string } | null>;
  };
  payment: {
    create(args: { data: Record<string, unknown> }): Promise<StoredPayment>;
    findUnique(args: { where: { id: string } }): Promise<StoredPayment | null>;
    findMany(args: {
      where?: Record<string, unknown>;
      orderBy: Array<Record<string, 'asc' | 'desc'>>;
      take?: number;
      skip?: number;
      cursor?: { id: string };
    }): Promise<StoredPayment[]>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<StoredPayment>;
    delete(args: { where: { id: string } }): Promise<StoredPayment>;
  };
  fxRate: {
    upsert(args: {
      where: { date_currency: { date: Date; currency: string } };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }): Promise<StoredFxRate>;
    findMany(args: {
      where?: Record<string, unknown>;
      orderBy: Array<Record<string, 'asc' | 'desc'>>;
    }): Promise<StoredFxRate[]>;
  };
}

export class PaymentService {
  constructor(
    private readonly repository: PaymentRepository,
    private readonly actionLogWriter: ActionLogWriter,
  ) {}

  // ── Payments ───────────────────────────────────────────────────────────────

  async createPayment(input: CreatePaymentInput): Promise<PaymentSummary> {
    const accountId = normalizeRequiredString(input.accountId, 'accountId');
    const date = normalizeDate(input.date, 'date');
    const depositSource = normalizeDepositSource(input.depositSource);
    const currency = normalizeCurrency(input.currency);
    const amount = normalizeDecimal(input.amount, 'amount');
    const krwEquivalent = normalizeDecimal(input.krwEquivalent, 'krwEquivalent');
    const type = input.type === undefined ? 'DEPOSIT' : normalizePaymentType(input.type);
    const depositorName =
      input.depositorName === undefined ? undefined : normalizeOptionalString(input.depositorName);
    const memo = input.memo === undefined ? undefined : normalizeOptionalString(input.memo);

    await this.assertAccountExists(accountId);

    const created = await this.repository.payment.create({
      data: {
        date,
        accountId,
        depositSource,
        currency,
        amount,
        krwEquivalent,
        type,
        ...(depositorName !== undefined ? { depositorName } : {}),
        ...(memo !== undefined ? { memo } : {}),
      },
    });

    await this.actionLogWriter.write({
      actorUserId: input.actorUserId,
      actionType: 'PAYMENT_CREATE',
      targetType: 'Payment',
      targetId: created.id,
      afterJson: toPaymentAuditPayload(created),
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    return toPaymentSummary(created);
  }

  async listPayments(input: ListPaymentsInput): Promise<ListPaymentsResult> {
    const limit = normalizeListLimit(input.limit);
    const cursor = normalizeOptionalString(input.cursor);
    const accountId = normalizeOptionalString(input.accountId);
    const currency = input.currency === undefined ? undefined : normalizeCurrency(input.currency);
    const dateFrom = input.dateFrom === undefined ? undefined : normalizeDate(input.dateFrom, 'dateFrom');
    const dateTo = input.dateTo === undefined ? undefined : normalizeDate(input.dateTo, 'dateTo');

    const where: Record<string, unknown> = {};

    if (accountId) {
      where.accountId = accountId;
    }
    if (currency) {
      where.currency = currency;
    }
    if (dateFrom || dateTo) {
      const dateFilter: Record<string, Date> = {};
      if (dateFrom) {
        dateFilter.gte = dateFrom;
      }
      if (dateTo) {
        dateFilter.lte = dateTo;
      }
      where.date = dateFilter;
    }

    const items = await this.repository.payment.findMany({
      ...(Object.keys(where).length > 0 ? { where } : {}),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });

    const hasMore = items.length > limit;
    const sliced = hasMore ? items.slice(0, limit) : items;
    const nextCursor = hasMore ? sliced[sliced.length - 1].id : null;

    return {
      items: sliced.map(toPaymentSummary),
      nextCursor,
    };
  }

  async getPayment(paymentId: string): Promise<PaymentSummary> {
    const id = normalizeRequiredString(paymentId, 'paymentId');
    const payment = await this.findPayment(id);
    return toPaymentSummary(payment);
  }

  async updatePayment(input: UpdatePaymentInput): Promise<PaymentSummary> {
    const paymentId = normalizeRequiredString(input.paymentId, 'paymentId');
    const current = await this.findPayment(paymentId);

    const changes: Record<string, unknown> = {};
    const beforeJson: Record<string, unknown> = {};
    const afterJson: Record<string, unknown> = {};

    if (input.date !== undefined) {
      const date = normalizeDate(input.date, 'date');
      if (date.getTime() !== current.date.getTime()) {
        changes.date = date;
        beforeJson.date = current.date.toISOString();
        afterJson.date = date.toISOString();
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

    if (input.currency !== undefined) {
      const currency = normalizeCurrency(input.currency);
      if (currency !== current.currency) {
        changes.currency = currency;
        beforeJson.currency = current.currency;
        afterJson.currency = currency;
      }
    }

    if (input.amount !== undefined) {
      const amount = normalizeDecimal(input.amount, 'amount');
      const currentAmount = current.amount.toString();
      if (amount !== currentAmount) {
        changes.amount = amount;
        beforeJson.amount = currentAmount;
        afterJson.amount = amount;
      }
    }

    if (input.krwEquivalent !== undefined) {
      const krwEquivalent = normalizeDecimal(input.krwEquivalent, 'krwEquivalent');
      const currentKrw = current.krwEquivalent.toString();
      if (krwEquivalent !== currentKrw) {
        changes.krwEquivalent = krwEquivalent;
        beforeJson.krwEquivalent = currentKrw;
        afterJson.krwEquivalent = krwEquivalent;
      }
    }

    if (input.type !== undefined) {
      const type = normalizePaymentType(input.type);
      if (type !== current.type) {
        changes.type = type;
        beforeJson.type = current.type;
        afterJson.type = type;
      }
    }

    if (input.depositorName !== undefined) {
      const depositorName =
        input.depositorName === null ? null : normalizeOptionalString(input.depositorName) ?? null;
      if (depositorName !== current.depositorName) {
        changes.depositorName = depositorName;
        beforeJson.depositorName = current.depositorName;
        afterJson.depositorName = depositorName;
      }
    }

    if (input.memo !== undefined) {
      const memo = input.memo === null ? null : normalizeOptionalString(input.memo) ?? null;
      if (memo !== current.memo) {
        changes.memo = memo;
        beforeJson.memo = current.memo;
        afterJson.memo = memo;
      }
    }

    if (Object.keys(changes).length === 0) {
      return toPaymentSummary(current);
    }

    const updated = await this.repository.payment.update({
      where: { id: paymentId },
      data: changes,
    });

    await this.actionLogWriter.write({
      actorUserId: input.actorUserId,
      actionType: 'PAYMENT_UPDATE',
      targetType: 'Payment',
      targetId: paymentId,
      beforeJson,
      afterJson,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    return toPaymentSummary(updated);
  }

  async deletePayment(input: DeletePaymentInput): Promise<PaymentSummary> {
    const paymentId = normalizeRequiredString(input.paymentId, 'paymentId');
    const current = await this.findPayment(paymentId);

    const deleted = await this.repository.payment.delete({ where: { id: paymentId } });

    await this.actionLogWriter.write({
      actorUserId: input.actorUserId,
      actionType: 'PAYMENT_DELETE',
      targetType: 'Payment',
      targetId: paymentId,
      beforeJson: toPaymentAuditPayload(current),
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    return toPaymentSummary(deleted);
  }

  // ── FX Rates ───────────────────────────────────────────────────────────────

  async upsertFxRate(input: UpsertFxRateInput): Promise<FxRateSummary> {
    const date = normalizeDate(input.date, 'date');
    const currency = normalizeCurrency(input.currency);
    const rateToKRW = normalizeFxRate(input.rateToKRW);

    const fxRate = await this.repository.fxRate.upsert({
      where: { date_currency: { date, currency } },
      create: { date, currency, rateToKRW },
      update: { rateToKRW },
    });

    return toFxRateSummary(fxRate);
  }

  async listFxRates(input: ListFxRatesInput): Promise<FxRateSummary[]> {
    const date = input.date === undefined ? undefined : normalizeDate(input.date, 'date');
    const currency = input.currency === undefined ? undefined : normalizeCurrency(input.currency);

    const where: Record<string, unknown> = {};
    if (date) {
      where.date = date;
    }
    if (currency) {
      where.currency = currency;
    }

    const items = await this.repository.fxRate.findMany({
      ...(Object.keys(where).length > 0 ? { where } : {}),
      orderBy: [{ date: 'desc' }, { currency: 'asc' }],
    });

    return items.map(toFxRateSummary);
  }

  // ── Balance ────────────────────────────────────────────────────────────────

  async getAccountBalance(accountId: string): Promise<AccountBalanceSummary> {
    const id = normalizeRequiredString(accountId, 'accountId');
    await this.assertAccountExists(id);

    const payments = await this.repository.payment.findMany({
      where: { accountId: id },
      orderBy: [{ createdAt: 'asc' }],
    });

    const buckets = new Map<Currency, { deposit: bigint; withdrawal: bigint }>();
    for (const currency of CURRENCIES) {
      buckets.set(currency, { deposit: 0n, withdrawal: 0n });
    }

    let krwTotalCents = 0n;

    for (const payment of payments) {
      const bucket = buckets.get(payment.currency);
      if (!bucket) {
        continue;
      }
      const amountCents = decimalToCents(payment.amount.toString());
      const krwCents = decimalToCents(payment.krwEquivalent.toString());

      if (payment.type === 'DEPOSIT') {
        bucket.deposit += amountCents;
        krwTotalCents += krwCents;
      } else if (payment.type === 'WITHDRAWAL') {
        bucket.withdrawal += amountCents;
        krwTotalCents -= krwCents;
      } else {
        if (amountCents >= 0n) {
          bucket.deposit += amountCents;
        } else {
          bucket.withdrawal += -amountCents;
        }
        krwTotalCents += krwCents;
      }
    }

    const balanceByCurrency = {} as Record<Currency, AccountBalanceCurrencyBucket>;
    for (const currency of CURRENCIES) {
      const bucket = buckets.get(currency)!;
      balanceByCurrency[currency] = {
        totalDeposit: centsToDecimal(bucket.deposit),
        totalWithdrawal: centsToDecimal(bucket.withdrawal),
        balance: centsToDecimal(bucket.deposit - bucket.withdrawal),
      };
    }

    return {
      accountId: id,
      balanceByCurrency,
      krwEquivalentTotal: centsToDecimal(krwTotalCents),
    };
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  private async findPayment(paymentId: string): Promise<StoredPayment> {
    const payment = await this.repository.payment.findUnique({ where: { id: paymentId } });

    if (!payment) {
      throw new DomainRuleError('PAYMENT_NOT_FOUND', 'Payment not found', 404);
    }

    return payment;
  }

  private async assertAccountExists(accountId: string): Promise<void> {
    const account = await this.repository.account.findUnique({ where: { id: accountId } });

    if (!account) {
      throw new DomainRuleError('ACCOUNT_NOT_FOUND', 'Account not found', 404);
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

function normalizeDate(value: unknown, field: string): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  throw new DomainRuleError('VALIDATION_ERROR', `${field} must be a valid date`, 400);
}

function normalizeCurrency(value: unknown): Currency {
  if (typeof value !== 'string' || !CURRENCIES.includes(value as Currency)) {
    throw new DomainRuleError(
      'VALIDATION_ERROR',
      'currency must be KRW, USD, EUR, or RUB',
      400,
    );
  }

  return value as Currency;
}

function normalizePaymentType(value: unknown): PaymentType {
  if (typeof value !== 'string' || !PAYMENT_TYPES.includes(value as PaymentType)) {
    throw new DomainRuleError(
      'VALIDATION_ERROR',
      'type must be DEPOSIT, WITHDRAWAL, or ADJUSTMENT',
      400,
    );
  }

  return value as PaymentType;
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

function normalizeDecimal(value: unknown, field: string): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toFixed(2);
  }

  if (typeof value !== 'string' || !AMOUNT_PATTERN.test(value.trim())) {
    throw new DomainRuleError(
      'VALIDATION_ERROR',
      `${field} must be a decimal string with up to 2 fractional digits`,
      400,
    );
  }

  return value.trim();
}

function normalizeFxRate(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toFixed(4);
  }

  if (typeof value !== 'string' || !FX_RATE_PATTERN.test(value.trim())) {
    throw new DomainRuleError(
      'VALIDATION_ERROR',
      'rateToKRW must be a decimal string',
      400,
    );
  }

  return value.trim();
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

function decimalToCents(value: string): bigint {
  const trimmed = value.trim();
  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [intPart, fracPartRaw = ''] = unsigned.split('.');
  const fracPart = (fracPartRaw + '00').slice(0, 2);
  const cents = BigInt(intPart || '0') * 100n + BigInt(fracPart || '0');
  return negative ? -cents : cents;
}

function centsToDecimal(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const intPart = abs / 100n;
  const fracPart = abs % 100n;
  const fracStr = fracPart.toString().padStart(2, '0');
  return `${negative ? '-' : ''}${intPart.toString()}.${fracStr}`;
}

function toPaymentSummary(payment: StoredPayment): PaymentSummary {
  return {
    id: payment.id,
    date: payment.date,
    accountId: payment.accountId,
    depositSource: payment.depositSource,
    currency: payment.currency,
    amount: payment.amount.toString(),
    krwEquivalent: payment.krwEquivalent.toString(),
    type: payment.type,
    depositorName: payment.depositorName,
    memo: payment.memo,
    createdAt: payment.createdAt,
  };
}

function toFxRateSummary(fxRate: StoredFxRate): FxRateSummary {
  return {
    id: fxRate.id,
    date: fxRate.date,
    currency: fxRate.currency,
    rateToKRW: fxRate.rateToKRW.toString(),
    createdAt: fxRate.createdAt,
  };
}

function toPaymentAuditPayload(payment: StoredPayment): Record<string, unknown> {
  return {
    date: payment.date.toISOString(),
    accountId: payment.accountId,
    depositSource: payment.depositSource,
    currency: payment.currency,
    amount: payment.amount.toString(),
    krwEquivalent: payment.krwEquivalent.toString(),
    type: payment.type,
    depositorName: payment.depositorName,
    memo: payment.memo,
  };
}
