import type { FastifyInstance } from 'fastify';
import type {
  AdjustInput,
  CreateProductInput,
  InboundInput,
  ListProductsInput,
  UpdateProductInput,
} from '@/application/product/product-service.js';
import type { ProductCategory } from '@/domain/shared/types.js';
import { successResponse, ValidationError } from '../api/index.js';
import { requirePermission, type AuthenticatedRequest } from '../auth/guards.js';

const PRODUCT_CATEGORIES: readonly ProductCategory[] = ['ALBUM', 'PHOTOCARD', 'GOODS'];

export function registerProductRoutes(server: FastifyInstance): void {
  server.post(
    '/products',
    { preHandler: requirePermission({ resource: 'product', action: 'write' }) },
    async (request, reply) => {
      const body = parseCreateBody(request.body);
      const result = await server.services.products.createProduct({
        actorUserId: (request as AuthenticatedRequest).authUser.id,
        ...body,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      reply.status(201);
      return successResponse(result);
    },
  );

  server.get(
    '/products',
    { preHandler: requirePermission({ resource: 'product', action: 'read' }) },
    async (request, reply) => {
      const query = parseListQuery(request.query);
      const result = await server.services.products.listProducts(query);

      reply.status(200);
      return successResponse(result);
    },
  );

  server.get(
    '/products/:id',
    { preHandler: requirePermission({ resource: 'product', action: 'read' }) },
    async (request, reply) => {
      const productId = parseProductId(request.params);
      const result = await server.services.products.getProduct(productId);

      reply.status(200);
      return successResponse(result);
    },
  );

  server.patch(
    '/products/:id',
    { preHandler: requirePermission({ resource: 'product', action: 'write' }) },
    async (request, reply) => {
      const productId = parseProductId(request.params);
      const body = parseUpdateBody(request.body);
      const result = await server.services.products.updateProduct({
        actorUserId: (request as AuthenticatedRequest).authUser.id,
        productId,
        ...body,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      reply.status(200);
      return successResponse(result);
    },
  );

  server.post(
    '/products/:id/inbound',
    { preHandler: requirePermission({ resource: 'product', action: 'write' }) },
    async (request, reply) => {
      const productId = parseProductId(request.params);
      const body = parseInboundBody(request.body);
      const result = await server.services.products.inbound({
        actorUserId: (request as AuthenticatedRequest).authUser.id,
        productId,
        ...body,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      reply.status(201);
      return successResponse(result);
    },
  );

  server.post(
    '/products/:id/adjust',
    { preHandler: requirePermission({ resource: 'product', action: 'write' }) },
    async (request, reply) => {
      const productId = parseProductId(request.params);
      const body = parseAdjustBody(request.body);
      const result = await server.services.products.adjust({
        actorUserId: (request as AuthenticatedRequest).authUser.id,
        productId,
        ...body,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      reply.status(200);
      return successResponse(result);
    },
  );

  server.get(
    '/products/:id/movements',
    { preHandler: requirePermission({ resource: 'product', action: 'read' }) },
    async (request, reply) => {
      const productId = parseProductId(request.params);
      const result = await server.services.products.listMovements(productId);

      reply.status(200);
      return successResponse(result);
    },
  );
}

type CreateBody = Omit<CreateProductInput, 'actorUserId' | 'ipAddress' | 'userAgent'>;
type UpdateBody = Omit<UpdateProductInput, 'actorUserId' | 'productId' | 'ipAddress' | 'userAgent'>;
type InboundBody = Omit<InboundInput, 'actorUserId' | 'productId' | 'ipAddress' | 'userAgent'>;
type AdjustBody = Omit<AdjustInput, 'actorUserId' | 'productId' | 'ipAddress' | 'userAgent'>;

function parseCreateBody(body: unknown): CreateBody {
  if (!isRecord(body)) {
    throw new ValidationError('Request body must be an object');
  }

  const name = parseRequiredString(body.name, 'name');
  const priceKRW = parseNonNegativeDecimal(body.priceKRW, 'priceKRW', 4);

  const result: CreateBody = { name, priceKRW };

  if (body.artistId !== undefined) {
    result.artistId = parseRequiredString(body.artistId, 'artistId');
  }

  if (body.category !== undefined) {
    result.category = parseCategory(body.category);
  }

  if (body.weightG !== undefined) {
    result.weightG = parseNonNegativeInteger(body.weightG, 'weightG');
  }

  if (body.sku !== undefined && body.sku !== null) {
    result.sku = parseRequiredString(body.sku, 'sku');
  }

  if (body.barcode !== undefined && body.barcode !== null) {
    result.barcode = parseRequiredString(body.barcode, 'barcode');
  }

  if (body.avgPurchasePriceKRW !== undefined) {
    result.avgPurchasePriceKRW = parseNonNegativeInteger(
      body.avgPurchasePriceKRW,
      'avgPurchasePriceKRW',
    );
  }

  return result;
}

function parseUpdateBody(body: unknown): UpdateBody {
  if (!isRecord(body)) {
    throw new ValidationError('Request body must be an object');
  }

  const result: UpdateBody = {};

  if (body.name !== undefined) {
    result.name = parseRequiredString(body.name, 'name');
  }

  if (body.weightG !== undefined) {
    result.weightG = parseNonNegativeInteger(body.weightG, 'weightG');
  }

  if (body.priceKRW !== undefined) {
    result.priceKRW = parseNonNegativeDecimal(body.priceKRW, 'priceKRW', 4);
  }

  if (body.sku !== undefined) {
    result.sku = body.sku === null ? null : parseRequiredString(body.sku, 'sku');
  }

  if (body.barcode !== undefined) {
    result.barcode = body.barcode === null ? null : parseRequiredString(body.barcode, 'barcode');
  }

  if (body.avgPurchasePriceKRW !== undefined) {
    result.avgPurchasePriceKRW = parseNonNegativeInteger(
      body.avgPurchasePriceKRW,
      'avgPurchasePriceKRW',
    );
  }

  return result;
}

function parseInboundBody(body: unknown): InboundBody {
  if (!isRecord(body)) {
    throw new ValidationError('Request body must be an object');
  }

  const quantity = parseInteger(body.quantity, 'quantity');

  const result: InboundBody = { quantity };

  if (body.reason !== undefined && body.reason !== null) {
    if (typeof body.reason !== 'string') {
      throw new ValidationError('reason must be a string');
    }
    result.reason = body.reason;
  }

  return result;
}

function parseAdjustBody(body: unknown): AdjustBody {
  if (!isRecord(body)) {
    throw new ValidationError('Request body must be an object');
  }

  const quantity = parseInteger(body.quantity, 'quantity');
  const reason = parseRequiredString(body.reason, 'reason');

  return { quantity, reason };
}

function parseListQuery(query: unknown): ListProductsInput {
  if (query !== undefined && query !== null && !isRecord(query)) {
    throw new ValidationError('Query must be an object');
  }

  const record = isRecord(query) ? query : {};
  const result: ListProductsInput = {};

  if (record.artistId !== undefined) {
    if (typeof record.artistId !== 'string' || record.artistId.trim() === '') {
      throw new ValidationError('artistId must be a non-empty string');
    }
    result.artistId = record.artistId;
  }

  if (record.category !== undefined) {
    result.category = parseCategory(record.category);
  }

  if (record.q !== undefined) {
    if (typeof record.q !== 'string') {
      throw new ValidationError('q must be a string');
    }
    result.q = record.q;
  }

  if (record.limit !== undefined) {
    if (typeof record.limit !== 'string' || !/^\d+$/.test(record.limit)) {
      throw new ValidationError('limit must be a positive integer');
    }
    result.limit = Number(record.limit);
  }

  if (record.cursor !== undefined) {
    if (typeof record.cursor !== 'string' || record.cursor.trim() === '') {
      throw new ValidationError('cursor must be a non-empty string');
    }
    result.cursor = record.cursor;
  }

  return result;
}

function parseProductId(params: unknown): string {
  if (!isRecord(params) || typeof params.id !== 'string' || params.id.trim() === '') {
    throw new ValidationError('product id is required');
  }

  return params.id;
}

function parseRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`${field} is required`);
  }

  return value;
}

function parseCategory(value: unknown): ProductCategory {
  if (typeof value !== 'string' || !PRODUCT_CATEGORIES.includes(value as ProductCategory)) {
    throw new ValidationError('category must be ALBUM, PHOTOCARD, or GOODS');
  }

  return value as ProductCategory;
}

function parseNonNegativeInteger(value: unknown, field: string): number {
  const parsed = parseInteger(value, field);
  if (parsed < 0) {
    throw new ValidationError(`${field} must be a non-negative integer`);
  }
  return parsed;
}

function parseNonNegativeDecimal(value: unknown, field: string, scale: number): string {
  const raw = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.replace(/,/g, '').trim() : '';
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw)) {
    throw new ValidationError(`${field} must be a non-negative decimal`);
  }
  const [integerPart, fractionalPart = ''] = raw.split('.');
  if (fractionalPart.length > scale) {
    throw new ValidationError(`${field} must have at most ${scale} decimal places`);
  }
  return `${integerPart}.${fractionalPart.padEnd(scale, '0')}`;
}

function parseInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ValidationError(`${field} must be an integer`);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
