import type { FastifyInstance } from 'fastify';
import { successResponse, ValidationError } from '../api/index.js';
import { requirePermission } from '../auth/guards.js';

interface UploadBody {
  fileName: string;
  contentType: string;
  contentBase64: string;
  draftId?: string;
  productId?: string;
}

export function registerUploadRoutes(server: FastifyInstance): void {
  server.post(
    '/uploads/product-detail-images',
    {
      preHandler: requirePermission({ resource: 'product', action: 'write' }),
      bodyLimit: 14 * 1024 * 1024,
    },
    async (request, reply) => {
      const body = parseUploadBody(request.body);
      const result = await server.services.productAssets.uploadProductDetailImage(body);
      reply.status(201);
      return successResponse(result);
    },
  );

  const handleLocalImage = async (request: { params: unknown }, reply: { header: (name: string, value: string) => unknown }) => {
    const key = parseImageKey(request.params);
    const image = await server.services.productAssets.readLocalProductDetailImage(key);
    reply.header('content-type', image.contentType);
    reply.header('cache-control', 'public, max-age=31536000, immutable');
    return image.buffer;
  };

  const handleS3Image = async (request: { params: unknown }, reply: { header: (name: string, value: string) => unknown }) => {
    const key = parseImageKey(request.params);
    const image = await server.services.productAssets.readS3ProductDetailImage(key);
    reply.header('content-type', image.contentType);
    reply.header('cache-control', 'public, max-age=31536000, immutable');
    return image.body;
  };

  server.get('/uploads/product-detail-images/local/:key', handleLocalImage);
  server.get('/uploads/product-detail-images/local/*', handleLocalImage);
  server.get('/uploads/product-detail-images/s3/:key', handleS3Image);
  server.get('/uploads/product-detail-images/s3/*', handleS3Image);
}

function parseUploadBody(body: unknown): UploadBody {
  if (!isRecord(body)) {
    throw new ValidationError('Request body must be an object');
  }
  const result: UploadBody = {
    fileName: parseRequiredString(body.fileName, 'fileName'),
    contentType: parseRequiredString(body.contentType, 'contentType'),
    contentBase64: parseRequiredString(body.contentBase64, 'contentBase64'),
  };
  if (body.draftId !== undefined && body.draftId !== null) {
    result.draftId = parseRequiredString(body.draftId, 'draftId');
  }
  if (body.productId !== undefined && body.productId !== null) {
    result.productId = parseRequiredString(body.productId, 'productId');
  }
  return result;
}

function parseImageKey(params: unknown): string {
  if (!isRecord(params)) {
    throw new ValidationError('image key is required');
  }
  const rawKey = typeof params.key === 'string' ? params.key : typeof params['*'] === 'string' ? params['*'] : null;
  if (!rawKey || rawKey.trim() === '') {
    throw new ValidationError('image key is required');
  }
  return decodeURIComponent(rawKey);
}

function parseRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`${field} is required`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
