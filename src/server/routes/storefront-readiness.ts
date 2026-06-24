import type { FastifyInstance } from 'fastify';
import { successResponse } from '../api/index.js';
import { requirePermission } from '../auth/guards.js';

export interface StorefrontReadinessResponse {
  homepage: {
    status: 'READY_SCAFFOLD_ONLY';
    publicAdapterEnabled: false;
    publishEnabled: false;
    reason: 'PUBLIC_ADAPTER_NOT_APPROVED';
  };
  calendar: {
    status: 'READY_ZERO_EVENTS';
    publicEvents: [];
    reason: 'PRODUCT_LEVEL_SALE_WINDOW_NOT_APPROVED';
    variantSaleWindowsUsed: false;
  };
}

export function registerStorefrontReadinessRoutes(server: FastifyInstance): void {
  server.get(
    '/storefront/readiness',
    { preHandler: requirePermission({ resource: 'product', action: 'read' }) },
    async (_request, reply) => {
      const calendarProjection = server.services.calendarEvents.projectPublicEvents([]);
      const response: StorefrontReadinessResponse = {
        homepage: {
          status: 'READY_SCAFFOLD_ONLY',
          publicAdapterEnabled: false,
          publishEnabled: false,
          reason: 'PUBLIC_ADAPTER_NOT_APPROVED',
        },
        calendar: {
          status: 'READY_ZERO_EVENTS',
          publicEvents: calendarProjection.publicEvents as [],
          reason: calendarProjection.reason,
          variantSaleWindowsUsed: false,
        },
      };

      reply.status(200);
      return successResponse(response);
    },
  );
}
