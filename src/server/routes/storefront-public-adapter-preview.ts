import type { FastifyInstance } from 'fastify';
import { successResponse } from '../api/index.js';
import { requirePermission } from '../auth/guards.js';

export function registerStorefrontPublicAdapterPreviewRoutes(server: FastifyInstance): void {
  server.get(
    '/storefront/public-adapter/preview',
    { preHandler: requirePermission({ resource: 'product', action: 'read' }) },
    async (_request, reply) => {
      const response = server.services.publicAdapterPreview.buildPreview();

      reply.status(200);
      return successResponse(response);
    },
  );
}
