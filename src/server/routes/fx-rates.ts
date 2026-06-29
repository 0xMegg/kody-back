import type { FastifyInstance } from 'fastify';
import type {
  Currency,
  ListFxRatesInput,
} from '@/application/payment/payment-service.js';
import { successResponse, ValidationError } from '../api/index.js';
import { requirePermission, type AuthenticatedRequest } from '../auth/guards.js';

const CURRENCIES: readonly Currency[] = ['KRW', 'USD', 'EUR', 'RUB'];

interface FxRateUpsertBody {
  date: Date;
  currency: Currency;
  rateToKRW: string;
}

export function registerFxRateRoutes(server: FastifyInstance): void {
  server.post(
    '/fx-rates',
    { preHandler: requirePermission({ resource: 'payment', action: 'write' }) },
    async (request, reply) => {
      const body = parseUpsertBody(request.body);
      const authRequest = request as AuthenticatedRequest;
      const result = await server.services.payments.upsertFxRate({
        ...body,
        actorUserId: authRequest.authUser.id,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      reply.status(201);
      return successResponse(result);
    },
  );

  server.get(
    '/fx-rates',
    { preHandler: requirePermission({ resource: 'payment', action: 'read' }) },
    async (request, reply) => {
      const query = parseListQuery(request.query);
      const result = await server.services.payments.listFxRates(query);

      reply.status(200);
      return successResponse(result);
    },
  );
}

function parseUpsertBody(body: unknown): FxRateUpsertBody {
  if (!isRecord(body)) {
    throw new ValidationError('Request body must be an object');
  }

  const date = parseDate(body.date, 'date');
  const currency = parseCurrency(body.currency);
  const rateToKRW = parseDecimalString(body.rateToKRW, 'rateToKRW');

  return { date, currency, rateToKRW };
}

function parseListQuery(query: unknown): ListFxRatesInput {
  if (query !== undefined && query !== null && !isRecord(query)) {
    throw new ValidationError('Query must be an object');
  }

  const record = isRecord(query) ? query : {};
  const result: ListFxRatesInput = {};

  if (record.date !== undefined) {
    result.date = parseDate(record.date, 'date');
  }

  if (record.currency !== undefined) {
    result.currency = parseCurrency(record.currency);
  }

  return result;
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
