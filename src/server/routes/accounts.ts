import type { FastifyInstance } from 'fastify';
import type {
  CreateAccountInput,
  ListAccountsInput,
  UpdateAccountInput,
} from '@/application/account/account-service.js';
import type {
  CreateShippingAddressInput,
  UpdateShippingAddressInput,
} from '@/application/account/shipping-address-service.js';
import type { DepositSource, Incoterm } from '@/domain/shared/types.js';
import { successResponse, ValidationError } from '../api/index.js';
import { requirePermission, type AuthenticatedRequest } from '../auth/guards.js';

const DEPOSIT_SOURCES: readonly DepositSource[] = ['NONGHYUP', 'HANA', 'PAYPAL', 'PAYONEER'];
const INCOTERMS: readonly Incoterm[] = ['EXW', 'FOB', 'CIF', 'DDP', 'DAP'];

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

  server.get(
    '/accounts/:id/balance',
    { preHandler: requirePermission({ resource: 'payment', action: 'read' }) },
    async (request, reply) => {
      const accountId = parseAccountId(request.params);
      const result = await server.services.payments.getAccountBalance(accountId);

      reply.status(200);
      return successResponse(result);
    },
  );

  server.post(
    '/accounts/:accountId/addresses',
    { preHandler: requirePermission({ resource: 'account', action: 'write' }) },
    async (request, reply) => {
      const accountId = parseAddressAccountId(request.params);
      const body = parseCreateAddressBody(request.body);
      const result = await server.services.shippingAddresses.createAddress({
        accountId,
        ...body,
      });

      reply.status(201);
      return successResponse(result);
    },
  );

  server.get(
    '/accounts/:accountId/addresses',
    { preHandler: requirePermission({ resource: 'account', action: 'read' }) },
    async (request, reply) => {
      const accountId = parseAddressAccountId(request.params);
      const result = await server.services.shippingAddresses.listAddresses(accountId);

      reply.status(200);
      return successResponse(result);
    },
  );

  server.get(
    '/accounts/:accountId/addresses/:addressId',
    { preHandler: requirePermission({ resource: 'account', action: 'read' }) },
    async (request, reply) => {
      const { accountId, addressId } = parseAddressParams(request.params);
      const result = await server.services.shippingAddresses.getAddress(accountId, addressId);

      reply.status(200);
      return successResponse(result);
    },
  );

  server.patch(
    '/accounts/:accountId/addresses/:addressId',
    { preHandler: requirePermission({ resource: 'account', action: 'write' }) },
    async (request, reply) => {
      const { accountId, addressId } = parseAddressParams(request.params);
      const body = parseUpdateAddressBody(request.body);
      const result = await server.services.shippingAddresses.updateAddress({
        accountId,
        addressId,
        ...body,
      });

      reply.status(200);
      return successResponse(result);
    },
  );

  server.delete(
    '/accounts/:accountId/addresses/:addressId',
    { preHandler: requirePermission({ resource: 'account', action: 'write' }) },
    async (request, reply) => {
      const { accountId, addressId } = parseAddressParams(request.params);
      const result = await server.services.shippingAddresses.deleteAddress({
        accountId,
        addressId,
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

type CreateAddressBody = Omit<CreateShippingAddressInput, 'accountId'>;
type UpdateAddressBody = Omit<UpdateShippingAddressInput, 'accountId' | 'addressId'>;

function parseAddressAccountId(params: unknown): string {
  if (
    !isRecord(params) ||
    typeof params.accountId !== 'string' ||
    params.accountId.trim() === ''
  ) {
    throw new ValidationError('account id is required');
  }

  return params.accountId;
}

function parseAddressParams(params: unknown): { accountId: string; addressId: string } {
  if (!isRecord(params)) {
    throw new ValidationError('account id is required');
  }

  if (typeof params.accountId !== 'string' || params.accountId.trim() === '') {
    throw new ValidationError('account id is required');
  }

  if (typeof params.addressId !== 'string' || params.addressId.trim() === '') {
    throw new ValidationError('address id is required');
  }

  return { accountId: params.accountId, addressId: params.addressId };
}

function parseCreateAddressBody(body: unknown): CreateAddressBody {
  if (!isRecord(body)) {
    throw new ValidationError('Request body must be an object');
  }

  const label = parseRequiredString(body.label, 'label');
  const country = parseRequiredString(body.country, 'country');
  const fullAddress = parseRequiredString(body.fullAddress, 'fullAddress');

  const result: CreateAddressBody = {
    label,
    country,
    fullAddress,
  };

  if (body.isPrimary !== undefined) {
    result.isPrimary = parseBoolean(body.isPrimary, 'isPrimary');
  }

  if (body.defaultIncoterm !== undefined && body.defaultIncoterm !== null) {
    result.defaultIncoterm = parseIncoterm(body.defaultIncoterm);
  }

  return result;
}

function parseUpdateAddressBody(body: unknown): UpdateAddressBody {
  if (!isRecord(body)) {
    throw new ValidationError('Request body must be an object');
  }

  const result: UpdateAddressBody = {};

  if (body.label !== undefined) {
    result.label = parseRequiredString(body.label, 'label');
  }

  if (body.country !== undefined) {
    result.country = parseRequiredString(body.country, 'country');
  }

  if (body.fullAddress !== undefined) {
    result.fullAddress = parseRequiredString(body.fullAddress, 'fullAddress');
  }

  if (body.isPrimary !== undefined) {
    result.isPrimary = parseBoolean(body.isPrimary, 'isPrimary');
  }

  if (body.defaultIncoterm !== undefined) {
    result.defaultIncoterm = body.defaultIncoterm === null ? null : parseIncoterm(body.defaultIncoterm);
  }

  return result;
}

function parseBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new ValidationError(`${field} must be a boolean`);
  }

  return value;
}

function parseIncoterm(value: unknown): Incoterm {
  if (typeof value !== 'string' || !INCOTERMS.includes(value as Incoterm)) {
    throw new ValidationError('defaultIncoterm must be EXW, FOB, CIF, DDP, or DAP');
  }

  return value as Incoterm;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
