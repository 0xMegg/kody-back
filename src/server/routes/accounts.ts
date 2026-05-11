import type { FastifyInstance } from 'fastify';
import type {
  CreateAccountInput,
  ListAccountsInput,
  UpdateAccountInput,
} from '@/application/account/account-service.js';
import type { DepositSource } from '@/domain/shared/types.js';
import { successResponse, ValidationError } from '../api/index.js';
import { requirePermission, type AuthenticatedRequest } from '../auth/guards.js';

const DEPOSIT_SOURCES: readonly DepositSource[] = ['NONGHYUP', 'HANA', 'PAYPAL', 'PAYONEER'];

export function registerAccountRoutes(server: FastifyInstance): void {
  server.post(
    '/accounts',
    { preHandler: requirePermission({ resource: 'account', action: 'write' }) },
    async (request, reply) => {
      const body = parseCreateBody(request.body);
      const result = await server.services.accounts.createAccount({
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
    '/accounts',
    { preHandler: requirePermission({ resource: 'account', action: 'read' }) },
    async (request, reply) => {
      const query = parseListQuery(request.query);
      const result = await server.services.accounts.listAccounts(query);

      reply.status(200);
      return successResponse(result);
    },
  );

  server.get(
    '/accounts/:id',
    { preHandler: requirePermission({ resource: 'account', action: 'read' }) },
    async (request, reply) => {
      const accountId = parseAccountId(request.params);
      const result = await server.services.accounts.getAccount(accountId);

      reply.status(200);
      return successResponse(result);
    },
  );

  server.patch(
    '/accounts/:id',
    { preHandler: requirePermission({ resource: 'account', action: 'write' }) },
    async (request, reply) => {
      const accountId = parseAccountId(request.params);
      const body = parseUpdateBody(request.body);
      const result = await server.services.accounts.updateAccount({
        actorUserId: (request as AuthenticatedRequest).authUser.id,
        accountId,
        ...body,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      reply.status(200);
      return successResponse(result);
    },
  );
}

type CreateBody = Omit<CreateAccountInput, 'actorUserId' | 'ipAddress' | 'userAgent'>;
type UpdateBody = Omit<
  UpdateAccountInput,
  'actorUserId' | 'accountId' | 'ipAddress' | 'userAgent'
>;

function parseCreateBody(body: unknown): CreateBody {
  if (!isRecord(body)) {
    throw new ValidationError('Request body must be an object');
  }

  const name = parseRequiredString(body.name, 'name');
  const representative = parseRequiredString(body.representative, 'representative');
  const primaryDepositorName = parseRequiredString(
    body.primaryDepositorName,
    'primaryDepositorName',
  );
  const internalSalesRepUserId = parseRequiredString(
    body.internalSalesRepUserId,
    'internalSalesRepUserId',
  );
  const depositSource = parseDepositSource(body.depositSource);

  const result: CreateBody = {
    name,
    representative,
    primaryDepositorName,
    internalSalesRepUserId,
    depositSource,
  };

  if (body.defaultDiscountRate !== undefined) {
    result.defaultDiscountRate = parseDiscountRate(body.defaultDiscountRate);
  }

  if (body.memo !== undefined) {
    result.memo = parseMemo(body.memo);
  }

  return result;
}

function parseUpdateBody(body: unknown): UpdateBody {
  if (!isRecord(body)) {
    throw new ValidationError('Request body must be an object');
  }

  const result: UpdateBody = {};

  if (body.name !== undefined) {
    result.name = parseRequiredString(body.name, 'name');
  }

  if (body.representative !== undefined) {
    result.representative = parseRequiredString(body.representative, 'representative');
  }

  if (body.primaryDepositorName !== undefined) {
    result.primaryDepositorName = parseRequiredString(
      body.primaryDepositorName,
      'primaryDepositorName',
    );
  }

  if (body.internalSalesRepUserId !== undefined) {
    result.internalSalesRepUserId = parseRequiredString(
      body.internalSalesRepUserId,
      'internalSalesRepUserId',
    );
  }

  if (body.defaultDiscountRate !== undefined) {
    result.defaultDiscountRate = parseDiscountRate(body.defaultDiscountRate);
  }

  if (body.depositSource !== undefined) {
    result.depositSource = parseDepositSource(body.depositSource);
  }

  if (body.memo !== undefined) {
    result.memo = body.memo === null ? null : parseMemo(body.memo);
  }

  return result;
}

function parseListQuery(query: unknown): ListAccountsInput {
  if (query !== undefined && query !== null && !isRecord(query)) {
    throw new ValidationError('Query must be an object');
  }

  const record = isRecord(query) ? query : {};
  const result: ListAccountsInput = {};

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

  if (record.q !== undefined) {
    if (typeof record.q !== 'string') {
      throw new ValidationError('q must be a string');
    }
    result.q = record.q;
  }

  return result;
}

function parseAccountId(params: unknown): string {
  if (!isRecord(params) || typeof params.id !== 'string' || params.id.trim() === '') {
    throw new ValidationError('account id is required');
  }

  return params.id;
}

function parseRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`${field} is required`);
  }

  return value;
}

function parseMemo(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ValidationError('memo must be a string');
  }

  return value;
}

function parseDepositSource(value: unknown): DepositSource {
  if (typeof value !== 'string' || !DEPOSIT_SOURCES.includes(value as DepositSource)) {
    throw new ValidationError(
      'depositSource must be NONGHYUP, HANA, PAYPAL, or PAYONEER',
    );
  }

  return value as DepositSource;
}

function parseDiscountRate(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ValidationError('defaultDiscountRate must be a number between 0 and 1');
  }

  if (value < 0 || value > 1) {
    throw new ValidationError('defaultDiscountRate must be between 0 and 1');
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
