import type { FastifyInstance } from 'fastify';
import type {
  CreateOrderInput,
  Currency,
  ListOrdersInput,
  OrderStatus,
} from '@/application/order/order-service.js';
import { successResponse, ValidationError } from '../api/index.js';
import { requirePermission, type AuthenticatedRequest } from '../auth/guards.js';

const CURRENCIES: readonly Currency[] = ['KRW', 'USD', 'EUR', 'RUB'];
const ORDER_STATUSES: readonly OrderStatus[] = ['PENDING', 'CONFIRMED', 'SUSPENDED'];

type CreateBody = Omit<CreateOrderInput, 'actorUserId' | 'ipAddress' | 'userAgent'>;

export function registerOrderRoutes(server: FastifyInstance): void {
  server.post(
    '/orders',
    { preHandler: requirePermission({ resource: 'order', action: 'write' }) },
    async (request, reply) => {
      const body = parseCreateBody(request.body);
      const result = await server.services.orders.createOrder({
        actorUserId: (request as AuthenticatedRequest).authUser.id,
        ...body,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });
      reply.status(201);
      return successResponse(result);
    },
  );

  server.get(
    '/orders',
    { preHandler: requirePermission({ resource: 'order', action: 'read' }) },
    async (request, reply) => {
      const result = await server.services.orders.listOrders(parseListQuery(request.query));
      reply.status(200);
      return successResponse(result);
    },
  );

  server.get(
    '/orders/:id',
    { preHandler: requirePermission({ resource: 'order', action: 'read' }) },
    async (request, reply) => {
      const result = await server.services.orders.getOrder(parseOrderId(request.params));
      reply.status(200);
      return successResponse(result);
    },
  );

  server.post(
    '/orders/:id/confirm',
    { preHandler: requirePermission({ resource: 'order', action: 'write' }) },
    async (request, reply) => {
      const result = await server.services.orders.confirmOrder({
        actorUserId: (request as AuthenticatedRequest).authUser.id,
        orderId: parseOrderId(request.params),
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });
      reply.status(200);
      return successResponse(result);
    },
  );

  server.post(
    '/orders/:id/suspend',
    { preHandler: requirePermission({ resource: 'order', action: 'write' }) },
    async (request, reply) => {
      const result = await server.services.orders.suspendOrder({
        actorUserId: (request as AuthenticatedRequest).authUser.id,
        orderId: parseOrderId(request.params),
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });
      reply.status(200);
      return successResponse(result);
    },
  );
}

function parseCreateBody(body: unknown): CreateBody {
  if (!isRecord(body)) throw new ValidationError('Request body must be an object');
  const result: CreateBody = {
    orderDate: parseDate(body.orderDate, 'orderDate'),
    accountId: parseRequiredString(body.accountId, 'accountId'),
    salesRepId: parseRequiredString(body.salesRepId, 'salesRepId'),
    currency: parseCurrency(body.currency),
    items: parseItems(body.items),
  };
  if (body.shippingFee !== undefined) result.shippingFee = parseNonNegativeDecimalString(body.shippingFee, 'shippingFee');
  if (body.remittanceFee !== undefined) result.remittanceFee = parseNonNegativeDecimalString(body.remittanceFee, 'remittanceFee');
  if (body.memo !== undefined && body.memo !== null) result.memo = parseString(body.memo, 'memo');
  return result;
}

function parseListQuery(query: unknown): ListOrdersInput {
  if (query !== undefined && query !== null && !isRecord(query)) throw new ValidationError('Query must be an object');
  const record = isRecord(query) ? query : {};
  const result: ListOrdersInput = {};
  if (record.accountId !== undefined) result.accountId = parseRequiredString(record.accountId, 'accountId');
  if (record.status !== undefined) result.status = parseStatus(record.status);
  if (record.limit !== undefined) {
    if (typeof record.limit !== 'string' || !/^\d+$/.test(record.limit)) {
      throw new ValidationError('limit must be a positive integer');
    }
    result.limit = Number(record.limit);
  }
  if (record.cursor !== undefined) result.cursor = parseRequiredString(record.cursor, 'cursor');
  return result;
}

function parseItems(value: unknown): CreateBody['items'] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ValidationError('items must contain at least one item');
  }
  return value.map((raw, index) => {
    if (!isRecord(raw)) throw new ValidationError(`items[${index}] must be an object`);
    const result = {
      productId: parseRequiredString(raw.productId, `items[${index}].productId`),
      unitPrice: parseNonNegativeDecimalString(raw.unitPrice, `items[${index}].unitPrice`),
      quantity: parsePositiveInteger(raw.quantity, `items[${index}].quantity`),
      ...(raw.discountRate !== undefined
        ? { discountRate: parseDecimalString(raw.discountRate, `items[${index}].discountRate`) }
        : {}),
    };
    return result;
  });
}

function parseOrderId(params: unknown): string {
  if (!isRecord(params) || typeof params.id !== 'string' || params.id.trim() === '') {
    throw new ValidationError('order id is required');
  }
  return params.id;
}

function parseRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new ValidationError(`${field} is required`);
  return value.trim();
}

function parseString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new ValidationError(`${field} must be a string`);
  return value;
}

function parseDate(value: unknown, field: string): Date {
  if (typeof value !== 'string' || value.trim() === '') throw new ValidationError(`${field} must be an ISO date string`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new ValidationError(`${field} must be a valid ISO date string`);
  return parsed;
}

function parseCurrency(value: unknown): Currency {
  if (typeof value !== 'string' || !CURRENCIES.includes(value as Currency)) {
    throw new ValidationError('currency must be KRW, USD, EUR, or RUB');
  }
  return value as Currency;
}

function parseStatus(value: unknown): OrderStatus {
  if (typeof value !== 'string' || !ORDER_STATUSES.includes(value as OrderStatus)) {
    throw new ValidationError('status must be PENDING, CONFIRMED, or SUSPENDED');
  }
  return value as OrderStatus;
}

function parseDecimalString(value: unknown, field: string): string {
  if (typeof value === 'number' && Number.isFinite(value)) return value.toString();
  if (typeof value !== 'string' || !/^-?\d+(\.\d+)?$/.test(value.trim())) {
    throw new ValidationError(`${field} must be a decimal number`);
  }
  return value.trim();
}

function parseNonNegativeDecimalString(value: unknown, field: string): string {
  const decimal = parseDecimalString(value, field);
  if (Number(decimal) < 0) throw new ValidationError(`${field} must be greater than or equal to 0`);
  return decimal;
}

function parsePositiveInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new ValidationError(`${field} must be a positive integer`);
  }
  return Number(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
