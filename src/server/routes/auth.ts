import type { FastifyInstance, FastifyRequest } from 'fastify';
import { successResponse, ValidationError } from '../api/index.js';

interface LoginBody {
  email: string;
  password: string;
  deviceInfo?: string;
}

interface RefreshBody {
  refreshToken: string;
}

export function registerAuthRoutes(server: FastifyInstance): void {
  server.post('/auth/login', async (request: FastifyRequest, reply) => {
    const body = parseLoginBody(request.body);
    const result = await server.services.auth.login({
      email: body.email,
      password: body.password,
      deviceInfo: body.deviceInfo,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });

    reply.status(200);
    return successResponse(result);
  });

  server.post('/auth/refresh', async (request: FastifyRequest, reply) => {
    const body = parseRefreshBody(request.body);
    const result = await server.services.auth.refresh(body.refreshToken);

    reply.status(200);
    return successResponse(result);
  });

  server.post('/auth/logout', async (request: FastifyRequest, reply) => {
    const body = parseRefreshBody(request.body);
    const result = await server.services.auth.logout({
      refreshToken: body.refreshToken,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });

    reply.status(200);
    return successResponse(result);
  });

  server.get('/auth/me', async (request: FastifyRequest, reply) => {
    const accessToken = parseBearerToken(request.headers.authorization);
    const result = await server.services.auth.currentUser(accessToken);

    reply.status(200);
    return successResponse(result);
  });
}

function parseLoginBody(body: unknown): LoginBody {
  if (!isRecord(body)) {
    throw new ValidationError('Request body must be an object');
  }

  const { email, password, deviceInfo } = body;

  if (typeof email !== 'string' || email.trim() === '') {
    throw new ValidationError('email is required');
  }

  if (typeof password !== 'string' || password === '') {
    throw new ValidationError('password is required');
  }

  if (deviceInfo !== undefined && typeof deviceInfo !== 'string') {
    throw new ValidationError('deviceInfo must be a string');
  }

  return {
    email,
    password,
    ...(deviceInfo !== undefined && { deviceInfo }),
  };
}

function parseRefreshBody(body: unknown): RefreshBody {
  if (!isRecord(body)) {
    throw new ValidationError('Request body must be an object');
  }

  const { refreshToken } = body;

  if (typeof refreshToken !== 'string' || refreshToken.trim() === '') {
    throw new ValidationError('refreshToken is required');
  }

  return {
    refreshToken,
  };
}

function parseBearerToken(authorization: string | undefined): string {
  if (!authorization) {
    throw new ValidationError('Authorization header is required');
  }

  const [scheme, token] = authorization.split(' ');

  if (scheme !== 'Bearer' || !token) {
    throw new ValidationError('Authorization header must use Bearer token');
  }

  return token;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
