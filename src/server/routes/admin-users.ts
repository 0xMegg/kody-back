import type { FastifyInstance } from 'fastify';
import type { Role, UserStatus } from '@/domain/shared/types.js';
import { successResponse, ValidationError } from '../api/index.js';
import { requirePermission, type AuthenticatedRequest } from '../auth/guards.js';

interface StatusBody {
  status: UserStatus;
  reason?: string;
}

interface RolesBody {
  roles: Role[];
  reason?: string;
}

export function registerAdminUserRoutes(server: FastifyInstance): void {
  server.get(
    '/admin/users',
    { preHandler: requirePermission({ resource: 'userAdmin', action: 'read' }) },
    async (_request, reply) => {
      const result = await server.services.adminUsers.listUsers();

      reply.status(200);
      return successResponse(result);
    },
  );

  server.get(
    '/admin/users/:id',
    { preHandler: requirePermission({ resource: 'userAdmin', action: 'read' }) },
    async (request, reply) => {
      const userId = parseUserId(request.params);
      const result = await server.services.adminUsers.getUser(userId);

      reply.status(200);
      return successResponse(result);
    },
  );

  server.patch(
    '/admin/users/:id/status',
    { preHandler: requirePermission({ resource: 'userAdmin', action: 'write' }) },
    async (request, reply) => {
      const body = parseStatusBody(request.body);
      const result = await server.services.adminUsers.updateStatus({
        actorUserId: (request as AuthenticatedRequest).authUser.id,
        userId: parseUserId(request.params),
        status: body.status,
        reason: body.reason,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      reply.status(200);
      return successResponse(result);
    },
  );

  server.put(
    '/admin/users/:id/roles',
    { preHandler: requirePermission({ resource: 'userAdmin', action: 'write' }) },
    async (request, reply) => {
      const body = parseRolesBody(request.body);
      const result = await server.services.adminUsers.replaceRoles({
        actorUserId: (request as AuthenticatedRequest).authUser.id,
        userId: parseUserId(request.params),
        roles: body.roles,
        reason: body.reason,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      reply.status(200);
      return successResponse(result);
    },
  );

  server.post(
    '/admin/users/:id/unlock',
    { preHandler: requirePermission({ resource: 'userAdmin', action: 'write' }) },
    async (request, reply) => {
      const result = await server.services.adminUsers.unlockUser({
        actorUserId: (request as AuthenticatedRequest).authUser.id,
        userId: parseUserId(request.params),
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      reply.status(200);
      return successResponse(result);
    },
  );
}

function parseUserId(params: unknown): string {
  if (!isRecord(params) || typeof params.id !== 'string' || params.id.trim() === '') {
    throw new ValidationError('user id is required');
  }

  return params.id;
}

function parseStatusBody(body: unknown): StatusBody {
  if (!isRecord(body)) {
    throw new ValidationError('Request body must be an object');
  }

  const { status, reason } = body;

  if (typeof status !== 'string') {
    throw new ValidationError('status is required');
  }

  if (!isUserStatus(status)) {
    throw new ValidationError('status must be ACTIVE, SUSPENDED, or INACTIVE');
  }

  if (reason !== undefined && typeof reason !== 'string') {
    throw new ValidationError('reason must be a string');
  }

  return {
    status,
    ...(reason !== undefined && { reason }),
  };
}

function parseRolesBody(body: unknown): RolesBody {
  if (!isRecord(body)) {
    throw new ValidationError('Request body must be an object');
  }

  const { roles, reason } = body;

  if (!Array.isArray(roles)) {
    throw new ValidationError('roles must be an array');
  }

  if (!roles.every(isRole)) {
    throw new ValidationError('roles contains an invalid value');
  }

  if (reason !== undefined && typeof reason !== 'string') {
    throw new ValidationError('reason must be a string');
  }

  return {
    roles,
    ...(reason !== undefined && { reason }),
  };
}

function isUserStatus(value: string): value is UserStatus {
  return value === 'ACTIVE' || value === 'SUSPENDED' || value === 'INACTIVE';
}

function isRole(value: unknown): value is Role {
  return (
    value === 'ADMIN' ||
    value === 'SALES' ||
    value === 'OPERATIONS' ||
    value === 'WAREHOUSE' ||
    value === 'FINANCE'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
