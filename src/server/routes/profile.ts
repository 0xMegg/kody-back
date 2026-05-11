import type { FastifyInstance } from 'fastify';
import { successResponse, ValidationError } from '../api/index.js';
import { requirePermission, type AuthenticatedRequest } from '../auth/guards.js';

interface ProfileBody {
  displayName?: string;
  profileImageUrl?: string | null;
}

interface PasswordBody {
  currentPassword: string;
  newPassword: string;
}

export function registerProfileRoutes(server: FastifyInstance): void {
  server.get(
    '/profile',
    { preHandler: requirePermission({ resource: 'profile', action: 'read' }) },
    async (request, reply) => {
      reply.status(200);
      return successResponse((request as AuthenticatedRequest).authUser);
    },
  );

  server.patch(
    '/profile',
    { preHandler: requirePermission({ resource: 'profile', action: 'write' }) },
    async (request, reply) => {
      const body = parseProfileBody(request.body);
      const result = await server.services.auth.updateProfile({
        userId: (request as AuthenticatedRequest).authUser.id,
        ...body,
      });

      reply.status(200);
      return successResponse(result);
    },
  );

  server.post(
    '/profile/password',
    { preHandler: requirePermission({ resource: 'profile', action: 'write' }) },
    async (request, reply) => {
      const body = parsePasswordBody(request.body);
      const result = await server.services.auth.changePassword({
        userId: (request as AuthenticatedRequest).authUser.id,
        currentPassword: body.currentPassword,
        newPassword: body.newPassword,
      });

      reply.status(200);
      return successResponse(result);
    },
  );
}

function parseProfileBody(body: unknown): ProfileBody {
  if (!isRecord(body)) {
    throw new ValidationError('Request body must be an object');
  }

  const { displayName, profileImageUrl } = body;

  if (displayName !== undefined && typeof displayName !== 'string') {
    throw new ValidationError('displayName must be a string');
  }

  if (
    profileImageUrl !== undefined &&
    profileImageUrl !== null &&
    typeof profileImageUrl !== 'string'
  ) {
    throw new ValidationError('profileImageUrl must be a string or null');
  }

  return {
    ...(displayName !== undefined && { displayName }),
    ...(profileImageUrl !== undefined && { profileImageUrl }),
  };
}

function parsePasswordBody(body: unknown): PasswordBody {
  if (!isRecord(body)) {
    throw new ValidationError('Request body must be an object');
  }

  const { currentPassword, newPassword } = body;

  if (typeof currentPassword !== 'string' || currentPassword === '') {
    throw new ValidationError('currentPassword is required');
  }

  if (typeof newPassword !== 'string' || newPassword === '') {
    throw new ValidationError('newPassword is required');
  }

  return {
    currentPassword,
    newPassword,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
