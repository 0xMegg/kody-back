import type { FastifyInstance } from 'fastify';
import { successResponse } from '../api/index.js';

export function registerHealthRoutes(server: FastifyInstance): void {
  server.get('/health', async (_request, _reply) => {
    let database = 'connected';

    try {
      await server.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'disconnected';
    }

    const status = database === 'connected' ? 'healthy' : 'degraded';

    return successResponse({
      status,
      timestamp: new Date().toISOString(),
      database,
    });
  });
}
