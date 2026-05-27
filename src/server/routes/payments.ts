import type { FastifyInstance } from 'fastify';
import type {
  CreatePaymentInput,
  Currency,
  DepositSource,
  ListPaymentsInput,
  PaymentType,
  UpdatePaymentInput,
} from '@/application/payment/payment-service.js';
import { successResponse, ValidationError } from '../api/index.js';
import { requirePermission, type AuthenticatedRequest } from '../auth/guards.js';

const CURRENCIES: readonly Currency[] = ['KRW', 'USD', 'EUR', 'RUB'];
const PAYMENT_TYPES: readonly PaymentType[] = ['DEPOSIT', 'WITHDRAWAL', 'ADJUSTMENT'];
const DEPOSIT_SOURCES: readonly DepositSource[] = ['NONGHYUP', 'HANA', 'PAYPAL', 'PAYONEER'];

export function registerPaymentRoutes(server: FastifyInstance): void {
  server.post(
    '/payments',
    { preHandler: requirePermission({ resource: 'payment', action: 'write' }) },
    async (request, reply) => {
      const body = parseCreateBody(request.body);
      const result = await server.services.payments.createPayment({
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
    '/payments',
    { preHandler: requirePermission({ resource: 'payment', action: 'read' }) },
    async (request, reply) => {
      const query = parseListQuery(request.query);
      const result = await server.services.payments.listPayments(query);

      reply.status(200);
      return successResponse(result);
    },
  );

  server.get(
    '/payments/:id',
    { preHandler: requirePermission({ resource: 'payment', action: 'read' }) },
    async (request, reply) => {
      const paymentId = parsePaymentId(request.params);
      const result = await server.services.payments.getPayment(paymentId);

      reply.status(200);
      return successResponse(result);
    },
  );

  server.patch(
    '/payments/:id',
    { preHandler: requirePermission({ resource: 'payment', action: 'write' }) },
    async (request, reply) => {
      const paymentId = parsePaymentId(request.params);
      const body = parseUpdateBody(request.body);
      const result = await server.services.payments.updatePayment({
        actorUserId: (request as AuthenticatedRequest).authUser.id,
        paymentId,
        ...body,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      reply.status(200);
      return successResponse(result);
    },
  );

  server.delete(
    '/payments/:id',
    { preHandler: requirePermission({ resource: 'payment', action: 'write' }) },
    async (request, reply) => {
      const paymentId = parsePaymentId(request.params);
      const result = await server.services.payments.deletePayment({
        actorUserId: (request as AuthenticatedRequest).authUser.id,
        paymentId,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      reply.status(200);
      return successResponse(result);
    },
  );
}

type CreateBody = Omit<CreatePaymentInput, 'actorUserId' | 'ipAddress' | 'userAgent'>;
type UpdateBody = Omit<
  UpdatePaymentInput,
  'actorUserId' | 'paymentId' | 'ipAddress' | 'userAgent'
>;

function parseCreateBody(body: unknown): CreateBody {
  if (!isRecord(body)) {
    throw new ValidationError('Request body must be an object');
  }

  const accountId = parseRequiredString(body.accountId, 'accountId');
  const date = parseDate(body.date, 'date');
  const depositSource = parseDepositSource(body.depositSource);
  const currency = parseCurrency(body.currency);
  const amount = parseDecimalString(body.amount, 'amount');
  const krwEquivalent = parseDecimalString(body.krwEquivalent, 'krwEquivalent');

  const result: CreateBody = {
    accountId,
    date,
    depositSource,
    currency,
    amount,
    krwEquivalent,
  };

  if (body.type !== undefined) {
    result.type = parsePaymentType(body.type);
  }

  if (body.depositorName !== undefined && body.depositorName !== null) {
    result.depositorName = parseRequiredString(body.depositorName, 'depositorName');
  }

  if (body.memo !== undefined && body.memo !== null) {
    if (typeof body.memo !== 'string') {
      throw new ValidationError('memo must be a string');
    }
    result.memo = body.memo;
  }

  return result;
}

function parseUpdateBody(body: unknown): UpdateBody {
  if (!isRecord(body)) {
    throw new ValidationError('Request body must be an object');
  }

  const result: UpdateBody = {};

  if (body.date !== undefined) {
    result.date = parseDate(body.date, 'date');
  }

  if (body.depositSource !== undefined) {
    result.depositSource = parseDepositSource(body.depositSource);
  }

  if (body.currency !== undefined) {
    result.currency = parseCurrency(body.currency);
  }

  if (body.amount !== undefined) {
    result.amount = parseDecimalString(body.amount, 'amount');
  }

  if (body.krwEquivalent !== undefined) {
    result.krwEquivalent = parseDecimalString(body.krwEquivalent, 'krwEquivalent');
  }

  if (body.type !== undefined) {
    result.type = parsePaymentType(body.type);
  }

  if (body.depositorName !== undefined) {
    result.depositorName =
      body.depositorName === null ? null : parseRequiredString(body.depositorName, 'depositorName');
  }

  if (body.memo !== undefined) {
    if (body.memo === null) {
      result.memo = null;
    } else if (typeof body.memo !== 'string') {
      throw new ValidationError('memo must be a string');
    } else {
      result.memo = body.memo;
    }
  }

  return result;
}

function parseListQuery(query: unknown): ListPaymentsInput {
  if (query !== undefined && query !== null && !isRecord(query)) {
    throw new ValidationError('Query must be an object');
  }

  const record = isRecord(query) ? query : {};
  const result: ListPaymentsInput = {};

  if (record.accountId !== undefined) {
    if (typeof record.accountId !== 'string' || record.accountId.trim() === '') {
      throw new ValidationError('accountId must be a non-empty string');
    }
    result.accountId = record.accountId;
  }

  if (record.currency !== undefined) {
    result.currency = parseCurrency(record.currency);
  }

  if (record.dateFrom !== undefined) {
    result.dateFrom = parseDate(record.dateFrom, 'dateFrom');
  }

  if (record.dateTo !== undefined) {
    result.dateTo = parseDate(record.dateTo, 'dateTo');
  }

  if (record.limit !== undefined) {
    if (typeof record.limit !== 'string' || !/^\d+$/.test(record.limit)) {
      throw new ValidationError('limit must be a positive integer');
    }
    result.limit = Number(record.limit);
  }

  if (record.cursor !== undefined) {
    if (typeof record.cursor !== 'string' || record.cursor.trim() === '') {
      throw new ValidationError('cursor must be a non-empty string');
    }
    result.cursor = record.cursor;
  }

  return result;
}

function parsePaymentId(params: unknown): string {
  if (!isRecord(params) || typeof params.id !== 'string' || params.id.trim() === '') {
    throw new ValidationError('payment id is required');
  }

  return params.id;
}

function parseRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`${field} is required`);
  }

  return value;
}

function parseDate(value: unknown, field: string): Date {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`${field} must be an ISO date string`);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError(`${field} must be a valid ISO date string`);
  }

  return parsed;
}

function parseCurrency(value: unknown): Currency {
  if (typeof value !== 'string' || !CURRENCIES.includes(value as Currency)) {
    throw new ValidationError('currency must be KRW, USD, EUR, or RUB');
  }

  return value as Currency;
}

function parsePaymentType(value: unknown): PaymentType {
  if (typeof value !== 'string' || !PAYMENT_TYPES.includes(value as PaymentType)) {
    throw new ValidationError('type must be DEPOSIT, WITHDRAWAL, or ADJUSTMENT');
  }

  return value as PaymentType;
}

function parseDepositSource(value: unknown): DepositSource {
  if (typeof value !== 'string' || !DEPOSIT_SOURCES.includes(value as DepositSource)) {
    throw new ValidationError('depositSource must be NONGHYUP, HANA, PAYPAL, or PAYONEER');
  }

  return value as DepositSource;
}

function parseDecimalString(value: unknown, field: string): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toString();
  }

  if (typeof value !== 'string' || !/^-?\d+(\.\d+)?$/.test(value.trim())) {
    throw new ValidationError(`${field} must be a decimal number`);
  }

  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
