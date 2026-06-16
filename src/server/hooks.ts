import type { FastifyInstance } from 'fastify';
import { ApiError, toApiError, errorResponse } from './api/index.js';
import { enterRequestContext } from './request-context.js';
import { safeRequestUrl } from './safe-request-url.js';

export function registerServerHooks(server: FastifyInstance): void {
  server.addHook('onRequest', (request, _reply, done) => {
    enterRequestContext({ requestId: request.id });
    done();
  });

  server.setErrorHandler((error, request, reply) => {
    const apiError = toApiError(error);

    server.log.error({
      requestId: request.id,
      method: request.method,
      url: safeRequestUrl(request.url),
      route: request.routeOptions.url,
      statusCode: apiError.statusCode,
      code: apiError.code,
      message: apiError.message,
    });

    reply
      .status(apiError.statusCode)
      .send(errorResponse(apiError.code, apiError.message, undefined, request.id));
  });

  server.setNotFoundHandler((request, reply) => {
    reply
      .status(404)
      .send(errorResponse('NOT_FOUND', 'Route not found', undefined, request.id));
  });
}
