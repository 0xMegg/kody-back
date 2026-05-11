import type { FastifyInstance } from 'fastify';
import type {
  LogQueryFilters,
  LogQueryPagination,
} from '@/application/logs/action-log-query-service.js';
import type { ActionType } from '@/domain/shared/types.js';
import { successResponse, ValidationError } from '../api/index.js';
import { requirePermission, type AuthenticatedRequest } from '../auth/guards.js';

const MIN_PAGE_SIZE = 1;
const MAX_PAGE_SIZE = 100;

const ACTION_TYPES: readonly ActionType[] = [
  'INVENTORY_ADJUST',
  'INVENTORY_INBOUND',
  'ORDER_CREATE',
  'ORDER_CONFIRM',
  'ORDER_CANCEL',
  'SHIPMENT_PICK',
  'SHIPMENT_PACK',
  'SHIPMENT_COMPLETE',
  'PAYMENT_CREATE',
  'ACCOUNT_CREATE',
  'ACCOUNT_UPDATE',
  'USER_LOGIN',
  'USER_LOGOUT',
  'USER_ROLE_CHANGE',
  'USER_STATUS_CHANGE',
];

export function registerLogsRoutes(server: FastifyInstance): void {
  server.get(
    '/logs',
    { preHandler: requirePermission({ resource: 'logs', action: 'read' }) },
    async (request, reply) => {
      const { filters, pagination } = parseQuery(request.query);
      const result = await server.services.logs.listLogs({
        authUser: (request as AuthenticatedRequest).authUser,
        filters,
        pagination,
      });

      reply.status(200);
      return successResponse(result);
    },
  );
}

interface ParsedQuery {
  filters: LogQueryFilters;
  pagination: LogQueryPagination;
}

function parseQuery(query: unknown): ParsedQuery {
  if (query !== undefined && query !== null && !isRecord(query)) {
    throw new ValidationError('Query must be an object');
  }

  const record = isRecord(query) ? query : {};

  const pagination: LogQueryPagination = {};
  const filters: LogQueryFilters = {};

  if (record.page !== undefined) {
    pagination.page = parsePositiveInteger(record.page, 'page');
  }

  if (record.pageSize !== undefined) {
    const pageSize = parsePositiveInteger(record.pageSize, 'pageSize');

    if (pageSize < MIN_PAGE_SIZE || pageSize > MAX_PAGE_SIZE) {
      throw new ValidationError(
        `pageSize must be between ${MIN_PAGE_SIZE} and ${MAX_PAGE_SIZE}`,
      );
    }

    pagination.pageSize = pageSize;
  }

  if (record.actorUserId !== undefined) {
    filters.actorUserId = parseNonEmptyString(record.actorUserId, 'actorUserId');
  }

  if (record.actionType !== undefined) {
    filters.actionType = parseActionType(record.actionType);
  }

  if (record.targetType !== undefined) {
    filters.targetType = parseNonEmptyString(record.targetType, 'targetType');
  }

  if (record.targetId !== undefined) {
    filters.targetId = parseNonEmptyString(record.targetId, 'targetId');
  }

  return { filters, pagination };
}

function parsePositiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new ValidationError(`${field} must be a positive integer`);
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new ValidationError(`${field} must be a positive integer`);
  }

  return parsed;
}

function parseNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`${field} must be a non-empty string`);
  }

  return value;
}

function parseActionType(value: unknown): ActionType {
  if (typeof value !== 'string') {
    throw new ValidationError('actionType must be a string');
  }

  if (!ACTION_TYPES.includes(value as ActionType)) {
    throw new ValidationError('actionType is not a valid value');
  }

  return value as ActionType;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
