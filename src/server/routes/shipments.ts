import type { FastifyInstance } from 'fastify';
import { requirePermission, type AuthenticatedRequest } from '../auth/guards.js';
import { successResponse, ValidationError } from '../api/index.js';

export function registerShipmentRoutes(server: FastifyInstance): void {
  server.post(
    '/shipments/:id/allocate',
    { preHandler: requirePermission({ resource: 'shipment', action: 'execute' }) },
    async (request, reply) => {
      const result = await server.services.shipments.allocateShipment({
        actorUserId: (request as AuthenticatedRequest).authUser.id,
        shipmentId: parseShipmentId(request.params),
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });
      reply.status(200);
      return successResponse(result);
    },
  );

  server.post(
    '/shipments/:id/pack',
    { preHandler: requirePermission({ resource: 'shipment', action: 'execute' }) },
    async (request, reply) => {
      const result = await server.services.shipments.packShipment({
        actorUserId: (request as AuthenticatedRequest).authUser.id,
        shipmentId: parseShipmentId(request.params),
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });
      reply.status(200);
      return successResponse(result);
    },
  );

  server.post(
    '/shipments/:id/complete',
    { preHandler: requirePermission({ resource: 'shipment', action: 'execute' }) },
    async (request, reply) => {
      const result = await server.services.shipments.completeShipment({
        actorUserId: (request as AuthenticatedRequest).authUser.id,
        shipmentId: parseShipmentId(request.params),
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });
      reply.status(200);
      return successResponse(result);
    },
  );
}

function parseShipmentId(params: unknown): string {
  if (!isRecord(params) || typeof params.id !== 'string' || params.id.trim() === '') {
    throw new ValidationError('shipment id is required');
  }
  return params.id.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
