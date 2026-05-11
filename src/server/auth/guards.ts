import type { FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { AuthenticatedUser } from '@/application/auth/auth-service.js';
import {
  hasPermission,
  type Permission,
} from '@/domain/auth/rbac.js';
import { AuthenticationError, AuthorizationError, ValidationError } from '@/server/api/index.js';

export type AuthenticatedRequest = FastifyRequest & {
  authUser: AuthenticatedUser;
};

export function requirePermission(permission: Permission): preHandlerHookHandler {
  return async (request) => {
    const accessToken = parseBearerToken(request.headers.authorization);
    const user = await request.server.services.auth.currentUser(accessToken);

    if (!hasPermission(user.roles, permission)) {
      throw new AuthorizationError();
    }

    (request as AuthenticatedRequest).authUser = user;
  };
}

function parseBearerToken(authorization: string | undefined): string {
  if (!authorization) {
    throw new AuthenticationError();
  }

  const [scheme, token] = authorization.split(' ');

  if (scheme !== 'Bearer' || !token) {
    throw new ValidationError('Authorization header must use Bearer token');
  }

  return token;
}
