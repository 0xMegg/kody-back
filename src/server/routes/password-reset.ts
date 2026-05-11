import type { FastifyInstance, FastifyRequest } from 'fastify';
import { successResponse, ValidationError } from '../api/index.js';

interface ForgotPasswordBody {
  email: string;
}

interface ValidateResetBody {
  token: string;
}

interface ResetPasswordBody {
  token: string;
  newPassword: string;
}

export function registerPasswordResetRoutes(server: FastifyInstance): void {
  server.post('/auth/forgot-password', async (request: FastifyRequest, reply) => {
    const body = parseForgotPasswordBody(request.body);
    const result = await server.services.passwordReset.requestReset({
      email: body.email,
      ipAddress: request.ip,
      ...(request.headers['user-agent'] !== undefined && {
        userAgent: request.headers['user-agent'],
      }),
    });

    reply.status(200);
    return successResponse(result);
  });

  server.post('/auth/reset-password/validate', async (request, reply) => {
    const body = parseValidateResetBody(request.body);
    const result = await server.services.passwordReset.validateReset(body.token);

    reply.status(200);
    return successResponse(result);
  });

  server.post('/auth/reset-password', async (request, reply) => {
    const body = parseResetPasswordBody(request.body);
    const result = await server.services.passwordReset.consumeReset({
      token: body.token,
      newPassword: body.newPassword,
    });

    reply.status(200);
    return successResponse(result);
  });
}

function parseForgotPasswordBody(body: unknown): ForgotPasswordBody {
  if (!isRecord(body)) {
    throw new ValidationError('Request body must be an object');
  }

  const { email } = body;

  if (typeof email !== 'string' || email.trim() === '') {
    throw new ValidationError('email is required');
  }

  return { email };
}

function parseValidateResetBody(body: unknown): ValidateResetBody {
  if (!isRecord(body)) {
    throw new ValidationError('Request body must be an object');
  }

  const { token } = body;

  if (typeof token !== 'string' || token === '') {
    throw new ValidationError('token is required');
  }

  return { token };
}

function parseResetPasswordBody(body: unknown): ResetPasswordBody {
  if (!isRecord(body)) {
    throw new ValidationError('Request body must be an object');
  }

  const { token, newPassword } = body;

  if (typeof token !== 'string' || token === '') {
    throw new ValidationError('token is required');
  }

  if (typeof newPassword !== 'string' || newPassword === '') {
    throw new ValidationError('newPassword is required');
  }

  return { token, newPassword };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
