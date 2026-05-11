import type { FastifyInstance } from 'fastify';
import { successResponse, ValidationError } from '../api/index.js';
import { requirePermission, type AuthenticatedRequest } from '../auth/guards.js';

interface CreateInviteBody {
  email: string;
  employeeId?: string;
}

interface ResendInviteBody {
  email: string;
}

interface ValidateInviteBody {
  token: string;
}

interface SignupBody {
  token: string;
  password: string;
  displayName: string;
}

export function registerInviteRoutes(server: FastifyInstance): void {
  server.post(
    '/admin/users/invite',
    { preHandler: requirePermission({ resource: 'userAdmin', action: 'write' }) },
    async (request, reply) => {
      const body = parseCreateInviteBody(request.body);
      const result = await server.services.invites.createInvite({
        actorUserId: (request as AuthenticatedRequest).authUser.id,
        email: body.email,
        ...(body.employeeId !== undefined && { employeeId: body.employeeId }),
      });

      reply.status(200);
      return successResponse(result);
    },
  );

  server.post(
    '/admin/users/invite/resend',
    { preHandler: requirePermission({ resource: 'userAdmin', action: 'write' }) },
    async (request, reply) => {
      const body = parseResendInviteBody(request.body);
      const result = await server.services.invites.resendInvite({
        actorUserId: (request as AuthenticatedRequest).authUser.id,
        email: body.email,
      });

      reply.status(200);
      return successResponse(result);
    },
  );

  server.post('/auth/invite/validate', async (request, reply) => {
    const body = parseValidateInviteBody(request.body);
    const result = await server.services.invites.validateInvite(body.token);

    reply.status(200);
    return successResponse(result);
  });

  server.post('/auth/signup', async (request, reply) => {
    const body = parseSignupBody(request.body);
    const result = await server.services.invites.consumeInvite({
      token: body.token,
      password: body.password,
      displayName: body.displayName,
    });

    reply.status(200);
    return successResponse(result);
  });
}

function parseCreateInviteBody(body: unknown): CreateInviteBody {
  if (!isRecord(body)) {
    throw new ValidationError('Request body must be an object');
  }

  const { email, employeeId } = body;

  if (typeof email !== 'string' || email.trim() === '') {
    throw new ValidationError('email is required');
  }

  if (employeeId !== undefined && (typeof employeeId !== 'string' || employeeId.trim() === '')) {
    throw new ValidationError('employeeId must be a non-empty string');
  }

  return {
    email,
    ...(employeeId !== undefined && { employeeId }),
  };
}

function parseResendInviteBody(body: unknown): ResendInviteBody {
  if (!isRecord(body)) {
    throw new ValidationError('Request body must be an object');
  }

  const { email } = body;

  if (typeof email !== 'string' || email.trim() === '') {
    throw new ValidationError('email is required');
  }

  return { email };
}

function parseValidateInviteBody(body: unknown): ValidateInviteBody {
  if (!isRecord(body)) {
    throw new ValidationError('Request body must be an object');
  }

  const { token } = body;

  if (typeof token !== 'string' || token === '') {
    throw new ValidationError('token is required');
  }

  return { token };
}

function parseSignupBody(body: unknown): SignupBody {
  if (!isRecord(body)) {
    throw new ValidationError('Request body must be an object');
  }

  const { token, password, displayName } = body;

  if (typeof token !== 'string' || token === '') {
    throw new ValidationError('token is required');
  }

  if (typeof password !== 'string' || password === '') {
    throw new ValidationError('password is required');
  }

  if (typeof displayName !== 'string' || displayName === '') {
    throw new ValidationError('displayName is required');
  }

  return { token, password, displayName };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
