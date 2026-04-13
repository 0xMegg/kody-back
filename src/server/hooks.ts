import type { FastifyInstance } from 'fastify';
import { ApiError, toApiError, errorResponse } from './api/index.js';

export function registerServerHooks(server: FastifyInstance): void {
  server.setErrorHandler((error, _request, reply) => {
    const apiError = toApiError(error);

    server.log.error({
      statusCode: apiError.statusCode,
      code: apiError.code,
      message: apiError.message,
    });

    reply
      .status(apiError.statusCode)
      .send(errorResponse(apiError.code, apiError.message));
  });

  server.setNotFoundHandler((_request, reply) => {
    reply
      .status(404)
      .send(errorResponse('NOT_FOUND', 'Route not found'));
  });
}
