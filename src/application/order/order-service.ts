import { DomainRuleError } from '@/domain/shared/errors.js';
import type { Currency, OrderStatus, ShipmentItemStatus } from '@/domain/shared/types.js';
import type { ActionLogWriter } from '@/application/shared/action-log-writer.js';

const CURRENCIES: readonly Currency[] = ['KRW', 'USD', 'EUR', 'RUB'];
const DEFAULT_LIST_LIMIT = 20;
const MIN_LIST_LIMIT = 1;
const MAX_LIST_LIMIT = 100;
const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

export type { Currency, OrderStatus };

export interface OrderItemSummary {
  id: string;
  orderId: string;
  productId: string;
  unitPrice: string;
  quantity: number;
  discountRate: string;
  subtotal: string;
  shipmentStatus: ShipmentItemStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderSummary {
  id: string;
  orderDate: Date;
  accountId: string;
  salesRepId: string;
  currency: Currency;
  status: OrderStatus;
  shippingFee: string;
  remittanceFee: string;
  memo: string | null;
  createdAt: Date;
  updatedAt: Date;
  items: OrderItemSummary[];
}

export interface CreateOrderItemInput {
  productId: string;
  unitPrice: string;
  quantity: number;
  discountRate?: string;
}

export interface CreateOrderInput {
  actorUserId: string;
  orderDate: Date;
  accountId: string;
  salesRepId: string;
  currency: Currency;
  shippingFee?: string;
  remittanceFee?: string;
  memo?: string;
  items: CreateOrderItemInput[];
  ipAddress?: string;
  userAgent?: string;
}

export interface ListOrdersInput {
  accountId?: string;
  status?: OrderStatus;
  limit?: number;
  cursor?: string;
}

export interface ListOrdersResult {
  items: OrderSummary[];
  nextCursor: string | null;
}

export interface TransitionOrderInput {
  actorUserId: string;
  orderId: string;
  ipAddress?: string;
  userAgent?: string;
}

interface DecimalLike {
  toString(): string;
}

interface StoredOrderItem {
  id: string;
  orderId: string;
  productId: string;
  unitPrice: DecimalLike;
  quantity: number;
  discountRate: DecimalLike;
  subtotal: DecimalLike;
  shipmentStatus: ShipmentItemStatus;
  createdAt: Date;
  updatedAt: Date;
}

interface StoredOrder {
  id: string;
  orderDate: Date;
  accountId: string;
  salesRepId: string;
  currency: Currency;
  status: OrderStatus;
  shippingFee: DecimalLike;
  remittanceFee: DecimalLike;
  memo: string | null;
  createdAt: Date;
  updatedAt: Date;
  items?: StoredOrderItem[];
}

interface OrderRepository {
  $transaction<T>(callback: (tx: OrderRepository) => Promise<T>): Promise<T>;
  account: { findUnique(args: { where: { id: string } }): Promise<{ id: string } | null> };
  user: { findUnique(args: { where: { id: string } }): Promise<{ id: string } | null> };
  product: {
    findUnique(args: { where: { id: string } }): Promise<{ id: string } | null>;
    update(args: { where: { id: string }; data: { orderBasedStock: { increment?: number; decrement?: number } } }): Promise<unknown>;
  };
  orderSequence: {
    upsert(args: {
      where: { date: string };
      create: { date: string; lastSeq: number };
      update: { lastSeq: { increment: number } };
    }): Promise<{ lastSeq: number }>;
  };
  order: {
    create(args: { data: Record<string, unknown>; include?: { items: boolean } }): Promise<StoredOrder>;
    findUnique(args: { where: { id: string }; include?: { items: boolean } }): Promise<StoredOrder | null>;
    findMany(args: {
      where?: Record<string, unknown>;
      include?: { items: boolean };
      orderBy: Array<Record<string, 'asc' | 'desc'>>;
      take?: number;
      skip?: number;
      cursor?: { id: string };
    }): Promise<StoredOrder[]>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
      include?: { items: boolean };
    }): Promise<StoredOrder>;
    updateMany(args: { where: { id: string; status: OrderStatus }; data: Record<string, unknown> }): Promise<{ count: number }>;
  };
}

export class OrderService {
  constructor(
    private readonly repository: OrderRepository,
    private readonly actionLogWriter: ActionLogWriter,
  ) {}

  async createOrder(input: CreateOrderInput): Promise<OrderSummary> {
    const orderDate = normalizeDate(input.orderDate, 'orderDate');
    const accountId = normalizeRequiredString(input.accountId, 'accountId');
    const salesRepId = normalizeRequiredString(input.salesRepId, 'salesRepId');
    const currency = normalizeCurrency(input.currency);
    const shippingFee = input.shippingFee === undefined ? '0' : normalizeNonNegativeDecimal(input.shippingFee, 'shippingFee');
    const remittanceFee = input.remittanceFee === undefined ? '0' : normalizeNonNegativeDecimal(input.remittanceFee, 'remittanceFee');
    const memo = input.memo === undefined ? undefined : normalizeOptionalString(input.memo);
    const items = normalizeCreateItems(input.items);

    const created = await this.repository.$transaction(async (tx) => {
      await assertAccountExists(tx, accountId);
      await assertUserExists(tx, salesRepId, 'SALES_REP_NOT_FOUND');
      for (const item of items) {
        await assertProductExists(tx, item.productId);
      }

      const datePrefix = formatDatePrefix(orderDate);
      const sequence = await tx.orderSequence.upsert({
        where: { date: datePrefix },
        create: { date: datePrefix, lastSeq: 1 },
        update: { lastSeq: { increment: 1 } },
      });
      if (sequence.lastSeq > 999) {
        throw new DomainRuleError('ORDER_SEQUENCE_LIMIT_EXCEEDED', 'Daily order sequence limit exceeded', 400);
      }
      const orderPrefix = `${datePrefix}${sequence.lastSeq.toString().padStart(3, '0')}`;
      const orderId = `${orderPrefix}0000`;

      return tx.order.create({
        data: {
          id: orderId,
          orderDate,
          accountId,
          salesRepId,
          currency,
          status: 'PENDING',
          shippingFee,
          remittanceFee,
          ...(memo !== undefined ? { memo } : {}),
          items: {
            create: items.map((item, index) => ({
              id: `${orderPrefix}${(index + 1).toString().padStart(4, '0')}`,
              productId: item.productId,
              unitPrice: item.unitPrice,
              quantity: item.quantity,
              discountRate: item.discountRate,
              subtotal: calculateSubtotal(item.unitPrice, item.quantity, item.discountRate),
              shipmentStatus: 'NOT_SHIPPED',
            })),
          },
        },
        include: { items: true },
      });
    });

    await this.actionLogWriter.write({
      actorUserId: input.actorUserId,
      actionType: 'ORDER_CREATE',
      targetType: 'Order',
      targetId: created.id,
      afterJson: toOrderAuditPayload(created),
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    return toOrderSummary(created);
  }

  async listOrders(input: ListOrdersInput): Promise<ListOrdersResult> {
    const limit = normalizeListLimit(input.limit);
    const cursor = normalizeOptionalString(input.cursor);
    const where: Record<string, unknown> = {};
    const accountId = normalizeOptionalString(input.accountId);
    if (accountId) where.accountId = accountId;
    if (input.status !== undefined) where.status = normalizeStatus(input.status);

    const items = await this.repository.order.findMany({
      ...(Object.keys(where).length > 0 ? { where } : {}),
      include: { items: true },
      orderBy: [{ orderDate: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });

    const hasMore = items.length > limit;
    const sliced = hasMore ? items.slice(0, limit) : items;
    return { items: sliced.map(toOrderSummary), nextCursor: hasMore ? sliced[sliced.length - 1].id : null };
  }

  async getOrder(orderId: string): Promise<OrderSummary> {
    return toOrderSummary(await this.findOrder(orderId));
  }

  async confirmOrder(input: TransitionOrderInput): Promise<OrderSummary> {
    const updated = await this.repository.$transaction(async (tx) => {
      const orderId = normalizeRequiredString(input.orderId, 'orderId');
      const transition = await tx.order.updateMany({
        where: { id: orderId, status: 'PENDING' },
        data: { status: 'CONFIRMED' },
      });
      if (transition.count === 0) {
        throw new DomainRuleError('ORDER_STATUS_INVALID', 'Only PENDING orders can be confirmed', 400);
      }
      const current = await findOrder(tx, orderId);
      for (const item of current.items ?? []) {
        await tx.product.update({
          where: { id: item.productId },
          data: { orderBasedStock: { decrement: item.quantity } },
        });
      }
      return current;
    });

    await this.actionLogWriter.write({
      actorUserId: input.actorUserId,
      actionType: 'ORDER_CONFIRM',
      targetType: 'Order',
      targetId: updated.id,
      afterJson: toOrderAuditPayload(updated),
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    return toOrderSummary(updated);
  }

  async suspendOrder(input: TransitionOrderInput): Promise<OrderSummary> {
    const updated = await this.repository.$transaction(async (tx) => {
      const orderId = normalizeRequiredString(input.orderId, 'orderId');
      const confirmedTransition = await tx.order.updateMany({
        where: { id: orderId, status: 'CONFIRMED' },
        data: { status: 'SUSPENDED' },
      });
      if (confirmedTransition.count === 1) {
        const current = await findOrder(tx, orderId);
        for (const item of current.items ?? []) {
          await tx.product.update({
            where: { id: item.productId },
            data: { orderBasedStock: { increment: item.quantity } },
          });
        }
        return current;
      }

      const pendingTransition = await tx.order.updateMany({
        where: { id: orderId, status: 'PENDING' },
        data: { status: 'SUSPENDED' },
      });
      if (pendingTransition.count === 1) {
        return findOrder(tx, orderId);
      }

      throw new DomainRuleError('ORDER_STATUS_INVALID', 'Only PENDING or CONFIRMED orders can be suspended', 400);
    });

    await this.actionLogWriter.write({
      actorUserId: input.actorUserId,
      actionType: 'ORDER_CANCEL',
      targetType: 'Order',
      targetId: updated.id,
      afterJson: toOrderAuditPayload(updated),
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    return toOrderSummary(updated);
  }

  private async findOrder(orderId: string): Promise<StoredOrder> {
    return findOrder(this.repository, orderId);
  }
}

async function findOrder(repository: OrderRepository, orderId: string): Promise<StoredOrder> {
  const id = normalizeRequiredString(orderId, 'orderId');
  const order = await repository.order.findUnique({ where: { id }, include: { items: true } });
  if (!order) throw new DomainRuleError('ORDER_NOT_FOUND', 'Order not found', 404);
  return order;
}

async function assertAccountExists(repository: OrderRepository, accountId: string): Promise<void> {
  if (!(await repository.account.findUnique({ where: { id: accountId } }))) {
    throw new DomainRuleError('ACCOUNT_NOT_FOUND', 'Account not found', 404);
  }
}

async function assertUserExists(repository: OrderRepository, userId: string, code: string): Promise<void> {
  if (!(await repository.user.findUnique({ where: { id: userId } }))) {
    throw new DomainRuleError(code, 'User not found', 404);
  }
}

async function assertProductExists(repository: OrderRepository, productId: string): Promise<void> {
  if (!(await repository.product.findUnique({ where: { id: productId } }))) {
    throw new DomainRuleError('PRODUCT_NOT_FOUND', 'Product not found', 404);
  }
}

function normalizeCreateItems(items: unknown): Required<CreateOrderItemInput>[] {
  if (!Array.isArray(items) || items.length === 0) {
    throw new DomainRuleError('VALIDATION_ERROR', 'items must contain at least one item', 400);
  }
  return items.map((raw, index) => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new DomainRuleError('VALIDATION_ERROR', `items[${index}] must be an object`, 400);
    }
    const item = raw as CreateOrderItemInput;
    return {
      productId: normalizeRequiredString(item.productId, `items[${index}].productId`),
      unitPrice: normalizeNonNegativeDecimal(item.unitPrice, `items[${index}].unitPrice`),
      quantity: normalizePositiveInteger(item.quantity, `items[${index}].quantity`),
      discountRate: item.discountRate === undefined ? '0' : normalizeDiscountRate(item.discountRate, `items[${index}].discountRate`),
    };
  });
}

function normalizeRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new DomainRuleError('VALIDATION_ERROR', `${field} is required`, 400);
  }
  return value.trim();
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function normalizeDate(value: unknown, field: string): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  throw new DomainRuleError('VALIDATION_ERROR', `${field} must be a valid date`, 400);
}

function normalizeCurrency(value: unknown): Currency {
  if (typeof value !== 'string' || !CURRENCIES.includes(value as Currency)) {
    throw new DomainRuleError('VALIDATION_ERROR', 'currency must be KRW, USD, EUR, or RUB', 400);
  }
  return value as Currency;
}

function normalizeStatus(value: unknown): OrderStatus {
  if (value !== 'PENDING' && value !== 'CONFIRMED' && value !== 'SUSPENDED') {
    throw new DomainRuleError('VALIDATION_ERROR', 'status must be PENDING, CONFIRMED, or SUSPENDED', 400);
  }
  return value;
}

function normalizeDecimal(value: unknown, field: string): string {
  if (typeof value === 'number' && Number.isFinite(value)) return value.toString();
  if (typeof value !== 'string' || !DECIMAL_PATTERN.test(value.trim())) {
    throw new DomainRuleError('VALIDATION_ERROR', `${field} must be a decimal number`, 400);
  }
  return value.trim();
}

function normalizeNonNegativeDecimal(value: unknown, field: string): string {
  const decimal = normalizeDecimal(value, field);
  if (Number(decimal) < 0) {
    throw new DomainRuleError('VALIDATION_ERROR', `${field} must be greater than or equal to 0`, 400);
  }
  return decimal;
}

function normalizeDiscountRate(value: unknown, field: string): string {
  const decimal = normalizeDecimal(value, field);
  const number = Number(decimal);
  if (number < 0 || number > 1) {
    throw new DomainRuleError('VALIDATION_ERROR', `${field} must be between 0 and 1`, 400);
  }
  return decimal;
}

function normalizePositiveInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new DomainRuleError('VALIDATION_ERROR', `${field} must be a positive integer`, 400);
  }
  return Number(value);
}

function normalizeListLimit(value: unknown): number {
  if (value === undefined) return DEFAULT_LIST_LIMIT;
  if (!Number.isInteger(value)) throw new DomainRuleError('VALIDATION_ERROR', 'limit must be a positive integer', 400);
  return Math.min(Math.max(Number(value), MIN_LIST_LIMIT), MAX_LIST_LIMIT);
}

function formatDatePrefix(date: Date): string {
  const year = date.getUTCFullYear().toString().slice(-2);
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = date.getUTCDate().toString().padStart(2, '0');
  return `${year}${month}${day}`;
}

function calculateSubtotal(unitPrice: string, quantity: number, discountRate: string): string {
  return (Number(unitPrice) * quantity * (1 - Number(discountRate))).toFixed(2);
}

function toOrderSummary(order: StoredOrder): OrderSummary {
  return {
    id: order.id,
    orderDate: order.orderDate,
    accountId: order.accountId,
    salesRepId: order.salesRepId,
    currency: order.currency,
    status: order.status,
    shippingFee: order.shippingFee.toString(),
    remittanceFee: order.remittanceFee.toString(),
    memo: order.memo,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    items: (order.items ?? []).map(toOrderItemSummary),
  };
}

function toOrderItemSummary(item: StoredOrderItem): OrderItemSummary {
  return {
    id: item.id,
    orderId: item.orderId,
    productId: item.productId,
    unitPrice: item.unitPrice.toString(),
    quantity: item.quantity,
    discountRate: item.discountRate.toString(),
    subtotal: item.subtotal.toString(),
    shipmentStatus: item.shipmentStatus,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function toOrderAuditPayload(order: StoredOrder): Record<string, unknown> {
  return {
    ...toOrderSummary(order),
    orderDate: order.orderDate.toISOString(),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    items: (order.items ?? []).map((item) => ({
      ...toOrderItemSummary(item),
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    })),
  };
}
