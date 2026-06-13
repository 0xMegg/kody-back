import type { FastifyInstance } from 'fastify';
import { ApiError, AuthorizationError, successResponse, ValidationError } from '../api/index.js';
import type { Role } from '@/domain/shared/types.js';
import {
  EXCEL_UPLOAD_MAX_BYTES,
  IMWEB_EXPORT_MAX_SELECTION,
  type ProductWorkbookUploadInput,
} from '@/application/product/product-excel-workflow.js';
import type {
  AdjustInput,
  CorrectExternalMappingInput,
  CreateProductInput,
  InboundInput,
  ListProductsInput,
  UpdateProductInput,
} from '@/application/product/product-service.js';
import type {
  CategoryMappingSource,
  CategoryReviewStatus,
  ProductCategory,
  ProductSaleStatus,
} from '@/domain/shared/types.js';
import { requirePermission, type AuthenticatedRequest } from '../auth/guards.js';

const PRODUCT_CATEGORIES: readonly ProductCategory[] = ['ALBUM', 'PHOTOCARD', 'GOODS'];
const PRODUCT_SALE_STATUSES: readonly ProductSaleStatus[] = ['ON_SALE', 'OFF_SALE', 'SOLD_OUT', 'DRAFT'];
const CATEGORY_MAPPING_SOURCES: readonly CategoryMappingSource[] = ['EXACT', 'FALLBACK', 'MANUAL'];
const CATEGORY_REVIEW_STATUSES: readonly CategoryReviewStatus[] = ['PENDING', 'MAPPED', 'NEEDS_REVIEW'];

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

  server.post(
    '/products/import/dry-run',
    { preHandler: requirePermission({ resource: 'product', action: 'read' }), bodyLimit: EXCEL_UPLOAD_MAX_BYTES * 2 },
    async (request, reply) => {
      assertAnyRole((request as AuthenticatedRequest).authUser.roles, ['ADMIN', 'OPERATIONS', 'FINANCE']);
      const body = parseWorkbookUploadBody(request.body);
      const result = await server.services.products.dryRunImwebProductWorkbook(body);

      reply.status(200);
      return successResponse(result);
    },
  );

  server.post(
    '/products/import/commit',
    { preHandler: requirePermission({ resource: 'product', action: 'write' }) },
    async (request, reply) => {
      assertAnyRole((request as AuthenticatedRequest).authUser.roles, ['ADMIN', 'FINANCE']);
      reply.status(403);
      throw new ApiError(403, 'COMMIT_DISABLED', 'Excel import commit is disabled for this goal; dry-run evidence is required and dev/prod writes need explicit approval.');
    },
  );

  server.post(
    '/products/export/imweb',
    { preHandler: requirePermission({ resource: 'product', action: 'read' }) },
    async (request, reply) => {
      assertAnyRole((request as AuthenticatedRequest).authUser.roles, ['ADMIN', 'OPERATIONS', 'FINANCE']);
      const productIds = parseProductIdsBody(request.body);
      if (productIds.length > IMWEB_EXPORT_MAX_SELECTION) {
        throw new ApiError(413, 'SELECTION_LIMIT_EXCEEDED', `Cannot export more than ${IMWEB_EXPORT_MAX_SELECTION} products at once.`);
      }
      const result = await server.services.products.exportImwebProducts(productIds);

      reply.status(200);
      return successResponse(result);
    },
  );

  server.post(
    '/products/external-mappings/correct',
    { preHandler: requirePermission({ resource: 'product', action: 'write' }) },
    async (request, reply) => {
      assertAnyRole((request as AuthenticatedRequest).authUser.roles, ['ADMIN']);
      const body = parseCorrectExternalMappingBody(request.body);
      const result = await server.services.products.correctExternalMapping({
        actorUserId: (request as AuthenticatedRequest).authUser.id,
        ...body,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

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
type CorrectExternalMappingBody = Omit<CorrectExternalMappingInput, 'actorUserId' | 'ipAddress' | 'userAgent'>;

function assertAnyRole(actualRoles: readonly Role[], allowedRoles: readonly Role[]): void {
  if (!actualRoles.some((role) => allowedRoles.includes(role))) {
    throw new AuthorizationError();
  }
}

function parseWorkbookUploadBody(body: unknown): ProductWorkbookUploadInput {
  if (!isRecord(body)) {
    throw new ValidationError('Request body must be an object');
  }
  const fileName = parseRequiredString(body.fileName, 'fileName');
  const contentBase64 = parseRequiredString(body.contentBase64, 'contentBase64');
  const sizeBytes = parseNonNegativeInteger(body.sizeBytes, 'sizeBytes');
  return { fileName, contentBase64, sizeBytes };
}

function parseProductIdsBody(body: unknown): string[] {
  if (!isRecord(body)) {
    throw new ValidationError('Request body must be an object');
  }
  return parseStringArray(body.productIds, 'productIds');
}

function parseCorrectExternalMappingBody(body: unknown): CorrectExternalMappingBody {
  if (!isRecord(body)) {
    throw new ValidationError('Request body must be an object');
  }
  const operation = parseExternalMappingOperation(body.operation);
  const result: CorrectExternalMappingBody = {
    mappingId: parseRequiredString(body.mappingId, 'mappingId'),
    operation,
    evidenceUrl: parseRequiredString(body.evidenceUrl, 'evidenceUrl'),
  };
  if (operation === 'REMAP') {
    result.newProductId = parseRequiredString(body.newProductId, 'newProductId');
  }
  if (body.reason !== undefined && body.reason !== null) {
    result.reason = parseRequiredString(body.reason, 'reason');
  }
  return result;
}

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

  if (body.initialStockOnHand !== undefined) {
    result.initialStockOnHand = parseNonNegativeInteger(
      body.initialStockOnHand,
      'initialStockOnHand',
    );
  }

  rejectDirectStockFields(body);

  if (body.labelName !== undefined) {
    result.labelName = body.labelName === null ? null : parseRequiredString(body.labelName, 'labelName');
  }

  if (body.detailHtml !== undefined) {
    result.detailHtml = body.detailHtml === null ? null : parseString(body.detailHtml, 'detailHtml');
  }

  if (body.releaseDateText !== undefined) {
    result.releaseDateText =
      body.releaseDateText === null ? null : parseRequiredString(body.releaseDateText, 'releaseDateText');
  }

  if (body.stockManaged !== undefined) {
    result.stockManaged = parseBoolean(body.stockManaged, 'stockManaged');
  }

  if (body.saleStatus !== undefined) {
    result.saleStatus = parseSaleStatus(body.saleStatus);
  }

  if (body.isDisplayed !== undefined) {
    result.isDisplayed = parseBoolean(body.isDisplayed, 'isDisplayed');
  }

  if (body.categoryMappingSource !== undefined) {
    result.categoryMappingSource = parseCategoryMappingSource(body.categoryMappingSource);
  }

  if (body.sourceCategoryCodes !== undefined) {
    result.sourceCategoryCodes = parseStringArray(body.sourceCategoryCodes, 'sourceCategoryCodes');
  }

  if (body.categoryReviewStatus !== undefined) {
    result.categoryReviewStatus = parseCategoryReviewStatus(body.categoryReviewStatus);
  }

  return result;
}

function parseUpdateBody(body: unknown): UpdateBody {
  if (!isRecord(body)) {
    throw new ValidationError('Request body must be an object');
  }

  const result: UpdateBody = {};

  if (body.artistId !== undefined) {
    result.artistId = body.artistId === null ? null : parseRequiredString(body.artistId, 'artistId');
  }

  if (body.category !== undefined) {
    result.category = body.category === null ? null : parseCategory(body.category);
  }

  if (body.name !== undefined) {
    result.name = parseRequiredString(body.name, 'name');
  }

  if (body.weightG !== undefined) {
    result.weightG = body.weightG === null ? null : parseNonNegativeInteger(body.weightG, 'weightG');
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

  if (body.labelName !== undefined) {
    result.labelName = body.labelName === null ? null : parseRequiredString(body.labelName, 'labelName');
  }

  if (body.detailHtml !== undefined) {
    result.detailHtml = body.detailHtml === null ? null : parseString(body.detailHtml, 'detailHtml');
  }

  if (body.releaseDateText !== undefined) {
    result.releaseDateText =
      body.releaseDateText === null ? null : parseRequiredString(body.releaseDateText, 'releaseDateText');
  }

  if (body.stockManaged !== undefined) {
    result.stockManaged = parseBoolean(body.stockManaged, 'stockManaged');
  }

  if (body.saleStatus !== undefined) {
    result.saleStatus = parseSaleStatus(body.saleStatus);
  }

  if (body.isDisplayed !== undefined) {
    result.isDisplayed = parseBoolean(body.isDisplayed, 'isDisplayed');
  }

  if (body.categoryMappingSource !== undefined) {
    result.categoryMappingSource = parseCategoryMappingSource(body.categoryMappingSource);
  }

  if (body.sourceCategoryCodes !== undefined) {
    result.sourceCategoryCodes = parseStringArray(body.sourceCategoryCodes, 'sourceCategoryCodes');
  }

  if (body.categoryReviewStatus !== undefined) {
    result.categoryReviewStatus = parseCategoryReviewStatus(body.categoryReviewStatus);
  }

  rejectDirectStockFields(body);

  return result;
}

function rejectDirectStockFields(body: Record<string, unknown>): void {
  for (const field of ['stockOnHand', 'orderBasedStock', 'shipmentBasedStock'] as const) {
    if (body[field] !== undefined) {
      throw new ValidationError(`${field} cannot be set directly; use initialStockOnHand on create or stock movement endpoints after create`);
    }
  }
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

function parseString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new ValidationError(`${field} must be a string`);
  }

  return value;
}

function parseExternalMappingOperation(value: unknown): 'REMAP' | 'DETACH' {
  if (value !== 'REMAP' && value !== 'DETACH') {
    throw new ValidationError('operation must be REMAP or DETACH');
  }
  return value;
}

function parseCategory(value: unknown): ProductCategory {
  if (typeof value !== 'string' || !PRODUCT_CATEGORIES.includes(value as ProductCategory)) {
    throw new ValidationError('category must be ALBUM, PHOTOCARD, or GOODS');
  }

  return value as ProductCategory;
}

function parseSaleStatus(value: unknown): ProductSaleStatus {
  if (typeof value !== 'string' || !PRODUCT_SALE_STATUSES.includes(value as ProductSaleStatus)) {
    throw new ValidationError(`saleStatus must be one of: ${PRODUCT_SALE_STATUSES.join(', ')}`);
  }

  return value as ProductSaleStatus;
}

function parseCategoryMappingSource(value: unknown): CategoryMappingSource {
  if (
    typeof value !== 'string' ||
    !CATEGORY_MAPPING_SOURCES.includes(value as CategoryMappingSource)
  ) {
    throw new ValidationError(
      `categoryMappingSource must be one of: ${CATEGORY_MAPPING_SOURCES.join(', ')}`,
    );
  }

  return value as CategoryMappingSource;
}

function parseCategoryReviewStatus(value: unknown): CategoryReviewStatus {
  if (
    typeof value !== 'string' ||
    !CATEGORY_REVIEW_STATUSES.includes(value as CategoryReviewStatus)
  ) {
    throw new ValidationError(
      `categoryReviewStatus must be one of: ${CATEGORY_REVIEW_STATUSES.join(', ')}`,
    );
  }

  return value as CategoryReviewStatus;
}

function parseBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new ValidationError(`${field} must be a boolean`);
  }

  return value;
}

function parseStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new ValidationError(`${field} must be an array of strings`);
  }

  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.trim() === '') {
      throw new ValidationError(`${field} must contain only non-empty strings`);
    }
    result.push(entry.trim());
  }

  return result;
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
