import type { FastifyInstance } from 'fastify';
import type { CreateArtistInput } from '@/application/product/product-service.js';
import { successResponse, ValidationError } from '../api/index.js';
import { requirePermission } from '../auth/guards.js';

export function registerArtistRoutes(server: FastifyInstance): void {
  server.post(
    '/artists',
    { preHandler: requirePermission({ resource: 'product', action: 'write' }) },
    async (request, reply) => {
      const body = parseCreateBody(request.body);
      const result = await server.services.products.createArtist(body);

      reply.status(201);
      return successResponse(result);
    },
  );

  server.get(
    '/artists',
    { preHandler: requirePermission({ resource: 'product', action: 'read' }) },
    async (_request, reply) => {
      const result = await server.services.products.listArtists();

      reply.status(200);
      return successResponse(result);
    },
  );

  server.get(
    '/artists/:id',
    { preHandler: requirePermission({ resource: 'product', action: 'read' }) },
    async (request, reply) => {
      const artistId = parseArtistId(request.params);
      const result = await server.services.products.getArtist(artistId);

      reply.status(200);
      return successResponse(result);
    },
  );
}

function parseCreateBody(body: unknown): CreateArtistInput {
  if (!isRecord(body)) {
    throw new ValidationError('Request body must be an object');
  }

  const name = parseRequiredString(body.name, 'name');
  const memberCount = parseNonNegativeInteger(body.memberCount, 'memberCount');

  return { name, memberCount };
}

function parseArtistId(params: unknown): string {
  if (!isRecord(params) || typeof params.id !== 'string' || params.id.trim() === '') {
    throw new ValidationError('artist id is required');
  }

  return params.id;
}

function parseRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`${field} is required`);
  }

  return value;
}

function parseNonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new ValidationError(`${field} must be a non-negative integer`);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
