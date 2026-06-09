import { DomainRuleError } from '@/domain/shared/errors.js';
import type { ProductCategory, StockMovementType } from '@/domain/shared/types.js';
import type { ActionLogWriter } from '@/application/shared/action-log-writer.js';
import type { ImwebMappedProduct } from '@/application/product/imweb-product-importer.js';

const PRODUCT_CATEGORIES: readonly ProductCategory[] = ['ALBUM', 'PHOTOCARD', 'GOODS'];

const DEFAULT_LIST_LIMIT = 20;
const MIN_LIST_LIMIT = 1;
const MAX_LIST_LIMIT = 100;

export interface ArtistSummary {
  id: string;
  name: string;
  memberCount: number;
  createdAt: Date;
}

export interface ProductSummary {
  id: string;
  artistId: string | null;
  category: ProductCategory | null;
  name: string;
  weightG: number | null;
  priceKRW: number;
  sku: string | null;
  barcode: string | null;
  avgPurchasePriceKRW: number;
  stockOnHand: number;
  orderBasedStock: number;
  shipmentBasedStock: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface StockMovementSummary {
  id: string;
  productId: string;
  type: StockMovementType;
  quantity: number;
  reason: string | null;
  createdById: string | null;
  createdAt: Date;
}

export interface CreateArtistInput {
  name: string;
  memberCount: number;
}

export interface CreateProductInput {
  actorUserId: string;
  artistId?: string;
  category?: ProductCategory;
  name: string;
  weightG?: number;
  priceKRW: number;
  sku?: string;
  barcode?: string;
  avgPurchasePriceKRW?: number;
  ipAddress?: string;
  userAgent?: string;
}

export interface ListProductsInput {
  artistId?: string;
  category?: ProductCategory;
  q?: string;
  limit?: number;
  cursor?: string;
}

export interface ListProductsResult {
  items: ProductSummary[];
  nextCursor: string | null;
}

export interface UpdateProductInput {
  actorUserId: string;
  productId: string;
  name?: string;
  weightG?: number;
  priceKRW?: number;
  sku?: string | null;
  barcode?: string | null;
  avgPurchasePriceKRW?: number;
  ipAddress?: string;
  userAgent?: string;
}

export interface InboundInput {
  actorUserId: string;
  productId: string;
  quantity: number;
  reason?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface AdjustInput {
  actorUserId: string;
  productId: string;
  quantity: number;
  reason: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface UpsertImwebProductInput {
  actorUserId: string;
  mapped: ImwebMappedProduct;
  importBatchId?: string;
  rawHash?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface UpsertImwebProductResult {
  status: 'create' | 'update';
  product: ProductSummary;
}

interface StoredArtist {
  id: string;
  name: string;
  memberCount: number;
  createdAt: Date;
}

interface StoredProduct {
  id: string;
  artistId: string | null;
  category: ProductCategory | null;
  name: string;
  weightG: number | null;
  priceKRW: number;
  sku: string | null;
  barcode: string | null;
  avgPurchasePriceKRW: number;
  stockOnHand: number;
  orderBasedStock: number;
  shipmentBasedStock: number;
  createdAt: Date;
  updatedAt: Date;
}

interface StoredStockMovement {
  id: string;
  productId: string;
  type: StockMovementType;
  quantity: number;
  reason: string | null;
  createdById: string | null;
  createdAt: Date;
}

interface StoredProductExternalMapping {
  id: string;
  productId: string;
  sourceSystem: string;
  externalProductId: string;
}

interface ProductRepository {
  artist: {
    create(args: { data: Record<string, unknown> }): Promise<StoredArtist>;
    findUnique(args: { where: { id: string } }): Promise<StoredArtist | null>;
    findMany(args: {
      orderBy: Array<Record<string, 'asc' | 'desc'>>;
    }): Promise<StoredArtist[]>;
  };
  product: {
    create(args: { data: Record<string, unknown> }): Promise<StoredProduct>;
    findUnique(args: {
      where: { id?: string; sku?: string; barcode?: string };
    }): Promise<StoredProduct | null>;
    findFirst(args: {
      where: Record<string, unknown>;
      orderBy?: { id: 'asc' | 'desc' };
    }): Promise<StoredProduct | null>;
    findMany(args: {
      where?: Record<string, unknown>;
      orderBy: Array<Record<string, 'asc' | 'desc'>>;
      take: number;
      skip?: number;
      cursor?: { id: string };
    }): Promise<StoredProduct[]>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<StoredProduct>;
  };
  productExternalMapping: {
    findUnique(args: {
      where: { sourceSystem_externalProductId: { sourceSystem: string; externalProductId: string } };
    }): Promise<StoredProductExternalMapping | null>;
    create(args: { data: Record<string, unknown> }): Promise<StoredProductExternalMapping>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<StoredProductExternalMapping>;
  };
  productSequence: {
    upsert(args: {
      where: { key: string };
      create: { key: string; lastSeq: number };
      update: { lastSeq: { increment: number } };
    }): Promise<{ key: string; lastSeq: number }>;
  };
  stockMovement: {
    create(args: { data: Record<string, unknown> }): Promise<StoredStockMovement>;
    findMany(args: {
      where: { productId: string };
      orderBy: Array<Record<string, 'asc' | 'desc'>>;
    }): Promise<StoredStockMovement[]>;
  };
}

export class ProductService {
  constructor(
    private readonly repository: ProductRepository,
    private readonly actionLogWriter: ActionLogWriter,
  ) {}

  // ── Artists ────────────────────────────────────────────────────────────────

  async createArtist(input: CreateArtistInput): Promise<ArtistSummary> {
    const name = normalizeRequiredString(input.name, 'name');
    const memberCount = normalizeNonNegativeInteger(input.memberCount, 'memberCount');

    const created = await this.repository.artist.create({
      data: { name, memberCount },
    });

    return toArtistSummary(created);
  }

  async listArtists(): Promise<ArtistSummary[]> {
    const items = await this.repository.artist.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    return items.map(toArtistSummary);
  }

  async getArtist(artistId: string): Promise<ArtistSummary> {
    const id = normalizeRequiredString(artistId, 'artistId');
    const artist = await this.findArtist(id);
    return toArtistSummary(artist);
  }

  // ── Products ───────────────────────────────────────────────────────────────

  async createProduct(input: CreateProductInput): Promise<ProductSummary> {
    const artistId = input.artistId === undefined ? undefined : normalizeRequiredString(input.artistId, 'artistId');
    const category = input.category === undefined ? undefined : normalizeCategory(input.category);
    const name = normalizeRequiredString(input.name, 'name');
    const weightG = input.weightG === undefined ? undefined : normalizeNonNegativeInteger(input.weightG, 'weightG');
    const priceKRW = normalizeNonNegativeInteger(input.priceKRW, 'priceKRW');
    const sku = input.sku === undefined ? undefined : normalizeOptionalString(input.sku);
    const barcode =
      input.barcode === undefined ? undefined : normalizeOptionalString(input.barcode);
    const avgPurchasePriceKRW =
      input.avgPurchasePriceKRW === undefined
        ? 0
        : normalizeNonNegativeInteger(input.avgPurchasePriceKRW, 'avgPurchasePriceKRW');

    if (artistId !== undefined) {
      await this.findArtist(artistId);
    }

    if (sku) {
      await this.assertSkuAvailable(sku);
    }
    if (barcode) {
      await this.assertBarcodeAvailable(barcode);
    }

    const productId = await this.generateProductId();

    const created = await this.repository.product.create({
      data: {
        id: productId,
        ...(artistId !== undefined ? { artistId } : {}),
        ...(category !== undefined ? { category } : {}),
        name,
        ...(weightG !== undefined ? { weightG } : {}),
        priceKRW,
        avgPurchasePriceKRW,
        ...(sku !== undefined ? { sku } : {}),
        ...(barcode !== undefined ? { barcode } : {}),
      },
    });

    await this.actionLogWriter.write({
      actorUserId: input.actorUserId,
      actionType: 'PRODUCT_CREATE',
      targetType: 'Product',
      targetId: created.id,
      afterJson: toProductAuditPayload(created),
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    return toProductSummary(created);
  }

  async listProducts(input: ListProductsInput): Promise<ListProductsResult> {
    const limit = normalizeListLimit(input.limit);
    const cursor = normalizeOptionalString(input.cursor);
    const artistId = normalizeOptionalString(input.artistId);
    const q = normalizeOptionalString(input.q);
    const category = input.category === undefined ? undefined : normalizeCategory(input.category);

    const where: Record<string, unknown> = {};

    if (artistId) {
      where.artistId = artistId;
    }
    if (category) {
      where.category = category;
    }
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { sku: { contains: q, mode: 'insensitive' } },
        { barcode: { contains: q, mode: 'insensitive' } },
      ];
    }

    const items = await this.repository.product.findMany({
      ...(Object.keys(where).length > 0 ? { where } : {}),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });

    const hasMore = items.length > limit;
    const sliced = hasMore ? items.slice(0, limit) : items;
    const nextCursor = hasMore ? sliced[sliced.length - 1].id : null;

    return {
      items: sliced.map(toProductSummary),
      nextCursor,
    };
  }

  async getProduct(productId: string): Promise<ProductSummary> {
    const id = normalizeRequiredString(productId, 'productId');
    const product = await this.findProduct(id);
    return toProductSummary(product);
  }

  async updateProduct(input: UpdateProductInput): Promise<ProductSummary> {
    const productId = normalizeRequiredString(input.productId, 'productId');
    const current = await this.findProduct(productId);

    const changes: Record<string, unknown> = {};
    const beforeJson: Record<string, unknown> = {};
    const afterJson: Record<string, unknown> = {};

    if (input.name !== undefined) {
      const name = normalizeRequiredString(input.name, 'name');
      if (name !== current.name) {
        changes.name = name;
        beforeJson.name = current.name;
        afterJson.name = name;
      }
    }

    if (input.weightG !== undefined) {
      const weightG = normalizeNonNegativeInteger(input.weightG, 'weightG');
      if (weightG !== current.weightG) {
        changes.weightG = weightG;
        beforeJson.weightG = current.weightG;
        afterJson.weightG = weightG;
      }
    }

    if (input.priceKRW !== undefined) {
      const priceKRW = normalizeNonNegativeInteger(input.priceKRW, 'priceKRW');
      if (priceKRW !== current.priceKRW) {
        changes.priceKRW = priceKRW;
        beforeJson.priceKRW = current.priceKRW;
        afterJson.priceKRW = priceKRW;
      }
    }

    if (input.sku !== undefined) {
      const sku = input.sku === null ? null : normalizeOptionalString(input.sku) ?? null;
      if (sku !== current.sku) {
        if (sku !== null) {
          await this.assertSkuAvailable(sku, productId);
        }
        changes.sku = sku;
        beforeJson.sku = current.sku;
        afterJson.sku = sku;
      }
    }

    if (input.barcode !== undefined) {
      const barcode =
        input.barcode === null ? null : normalizeOptionalString(input.barcode) ?? null;
      if (barcode !== current.barcode) {
        if (barcode !== null) {
          await this.assertBarcodeAvailable(barcode, productId);
        }
        changes.barcode = barcode;
        beforeJson.barcode = current.barcode;
        afterJson.barcode = barcode;
      }
    }

    if (input.avgPurchasePriceKRW !== undefined) {
      const avgPurchasePriceKRW = normalizeNonNegativeInteger(
        input.avgPurchasePriceKRW,
        'avgPurchasePriceKRW',
      );
      if (avgPurchasePriceKRW !== current.avgPurchasePriceKRW) {
        changes.avgPurchasePriceKRW = avgPurchasePriceKRW;
        beforeJson.avgPurchasePriceKRW = current.avgPurchasePriceKRW;
        afterJson.avgPurchasePriceKRW = avgPurchasePriceKRW;
      }
    }

    if (Object.keys(changes).length === 0) {
      return toProductSummary(current);
    }

    const updated = await this.repository.product.update({
      where: { id: productId },
      data: changes,
    });

    await this.actionLogWriter.write({
      actorUserId: input.actorUserId,
      actionType: 'PRODUCT_UPDATE',
      targetType: 'Product',
      targetId: productId,
      beforeJson,
      afterJson,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    return toProductSummary(updated);
  }

  async upsertImwebProduct(input: UpsertImwebProductInput): Promise<UpsertImwebProductResult> {
    const externalProductId = normalizeRequiredString(input.mapped.externalProductId, 'externalProductId');
    const mapping = await this.repository.productExternalMapping.findUnique({
      where: {
        sourceSystem_externalProductId: {
          sourceSystem: 'IMWEB_KR',
          externalProductId,
        },
      },
    });
    const productData = toImwebProductWriteData(input.mapped);

    if (mapping) {
      const current = await this.findProduct(mapping.productId);
      const updated = await this.repository.product.update({
        where: { id: current.id },
        data: productData,
      });

      await this.repository.productExternalMapping.update({
        where: { id: mapping.id },
        data: toImwebMappingRefreshData(input),
      });

      await this.actionLogWriter.write({
        actorUserId: input.actorUserId,
        actionType: 'PRODUCT_UPDATE',
        targetType: 'Product',
        targetId: updated.id,
        beforeJson: toProductAuditPayload(current),
        afterJson: toProductAuditPayload(updated),
        metadataJson: { sourceSystem: 'IMWEB_KR', externalProductId, importBatchId: input.importBatchId ?? null },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      });

      return { status: 'update', product: toProductSummary(updated) };
    }

    const productId = await this.generateProductId();
    const created = await this.repository.product.create({
      data: {
        id: productId,
        ...productData,
      },
    });

    await this.repository.productExternalMapping.create({
      data: {
        productId: created.id,
        sourceSystem: 'IMWEB_KR',
        externalProductId,
        ...toImwebMappingRefreshData(input),
        firstImportBatchId: input.importBatchId ?? null,
      },
    });

    await this.actionLogWriter.write({
      actorUserId: input.actorUserId,
      actionType: 'PRODUCT_CREATE',
      targetType: 'Product',
      targetId: created.id,
      afterJson: toProductAuditPayload(created),
      metadataJson: { sourceSystem: 'IMWEB_KR', externalProductId, importBatchId: input.importBatchId ?? null },
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    return { status: 'create', product: toProductSummary(created) };
  }

  // ── Stock ──────────────────────────────────────────────────────────────────

  async inbound(input: InboundInput): Promise<StockMovementSummary> {
    const productId = normalizeRequiredString(input.productId, 'productId');
    const quantity = normalizeQuantity(input.quantity);

    if (quantity <= 0) {
      throw new DomainRuleError('INVALID_QUANTITY', 'quantity must be positive for inbound', 400);
    }

    const reason = input.reason === undefined ? undefined : normalizeOptionalString(input.reason);

    await this.findProduct(productId);

    await this.repository.product.update({
      where: { id: productId },
      data: {
        stockOnHand: { increment: quantity },
        shipmentBasedStock: { increment: quantity },
      },
    });

    const movement = await this.repository.stockMovement.create({
      data: {
        productId,
        type: 'INBOUND',
        quantity,
        ...(reason !== undefined ? { reason } : {}),
        createdById: input.actorUserId,
      },
    });

    await this.actionLogWriter.write({
      actorUserId: input.actorUserId,
      actionType: 'INVENTORY_INBOUND',
      targetType: 'Product',
      targetId: productId,
      afterJson: { quantity, reason: reason ?? null, movementId: movement.id },
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    return toMovementSummary(movement);
  }

  async adjust(input: AdjustInput): Promise<StockMovementSummary> {
    const productId = normalizeRequiredString(input.productId, 'productId');
    const quantity = normalizeQuantity(input.quantity);

    if (quantity === 0) {
      throw new DomainRuleError('INVALID_QUANTITY', 'quantity must be nonzero for adjust', 400);
    }

    const reason = normalizeRequiredString(input.reason, 'reason');

    await this.findProduct(productId);

    await this.repository.product.update({
      where: { id: productId },
      data: {
        stockOnHand: { increment: quantity },
        shipmentBasedStock: { increment: quantity },
      },
    });

    const movement = await this.repository.stockMovement.create({
      data: {
        productId,
        type: 'ADJUSTMENT',
        quantity,
        reason,
        createdById: input.actorUserId,
      },
    });

    await this.actionLogWriter.write({
      actorUserId: input.actorUserId,
      actionType: 'INVENTORY_ADJUST',
      targetType: 'Product',
      targetId: productId,
      afterJson: { quantity, reason, movementId: movement.id },
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    return toMovementSummary(movement);
  }

  async listMovements(productId: string): Promise<StockMovementSummary[]> {
    const id = normalizeRequiredString(productId, 'productId');
    await this.findProduct(id);

    const movements = await this.repository.stockMovement.findMany({
      where: { productId: id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    return movements.map(toMovementSummary);
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  private async findArtist(artistId: string): Promise<StoredArtist> {
    const artist = await this.repository.artist.findUnique({ where: { id: artistId } });

    if (!artist) {
      throw new DomainRuleError('ARTIST_NOT_FOUND', 'Artist not found', 404);
    }

    return artist;
  }

  private async findProduct(productId: string): Promise<StoredProduct> {
    const product = await this.repository.product.findUnique({ where: { id: productId } });

    if (!product) {
      throw new DomainRuleError('PRODUCT_NOT_FOUND', 'Product not found', 404);
    }

    return product;
  }

  private async assertSkuAvailable(sku: string, exceptProductId?: string): Promise<void> {
    const existing = await this.repository.product.findFirst({ where: { sku } });
    if (existing && existing.id !== exceptProductId) {
      throw new DomainRuleError('DUPLICATE_SKU', 'sku is already in use', 409);
    }
  }

  private async assertBarcodeAvailable(barcode: string, exceptProductId?: string): Promise<void> {
    const existing = await this.repository.product.findFirst({ where: { barcode } });
    if (existing && existing.id !== exceptProductId) {
      throw new DomainRuleError('DUPLICATE_BARCODE', 'barcode is already in use', 409);
    }
  }

  private async generateProductId(): Promise<string> {
    const sequence = await this.repository.productSequence.upsert({
      where: { key: 'KODY-PROD' },
      create: { key: 'KODY-PROD', lastSeq: 1 },
      update: { lastSeq: { increment: 1 } },
    });

    return `KODY-PROD-${String(sequence.lastSeq).padStart(6, '0')}`;
  }
}


function normalizeRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new DomainRuleError('VALIDATION_ERROR', `${field} is required`, 400);
  }

  return value.trim();
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function normalizeCategory(value: unknown): ProductCategory {
  if (typeof value !== 'string' || !PRODUCT_CATEGORIES.includes(value as ProductCategory)) {
    throw new DomainRuleError(
      'VALIDATION_ERROR',
      'category must be ALBUM, PHOTOCARD, or GOODS',
      400,
    );
  }

  return value as ProductCategory;
}

function normalizeNonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new DomainRuleError('VALIDATION_ERROR', `${field} must be a non-negative integer`, 400);
  }

  if (value < 0) {
    throw new DomainRuleError('VALIDATION_ERROR', `${field} must be a non-negative integer`, 400);
  }

  return value;
}

function normalizeQuantity(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new DomainRuleError('INVALID_QUANTITY', 'quantity must be an integer', 400);
  }

  return value;
}

function toImwebProductWriteData(mapped: ImwebMappedProduct): Record<string, unknown> {
  return {
    category: mapped.category,
    sourceCategoryCodes: mapped.rawCategoryIds,
    name: mapped.name,
    labelName: normalizeOptionalString(mapped.artistName) ?? null,
    thumbnailUrl: normalizeOptionalString(mapped.thumbnailUrl) ?? null,
    weightG: mapped.weightG,
    priceKRW: mapped.priceKRW,
    sku: normalizeOptionalString(mapped.sku) ?? null,
    barcode: normalizeOptionalString(mapped.barcode) ?? null,
    stockOnHand: mapped.stockOnHand,
    avgPurchasePriceKRW: mapped.avgPurchasePriceKRW,
    saleStatus: toProductSaleStatus(mapped.saleStatus),
    isDisplayed: mapped.displayStatus,
  };
}

function toImwebMappingRefreshData(input: UpsertImwebProductInput): Record<string, unknown> {
  return {
    externalUrl: normalizeOptionalString(input.mapped.productUrl) ?? null,
    lastImportBatchId: input.importBatchId ?? null,
    lastRawHash: input.rawHash ?? null,
    status: 'ACTIVE',
  };
}

function toProductSaleStatus(value: string | null): 'ON_SALE' | 'OFF_SALE' | 'SOLD_OUT' | 'DRAFT' {
  if (value === '판매중') return 'ON_SALE';
  if (value === '품절') return 'SOLD_OUT';
  if (value === '판매안함' || value === '판매중지') return 'OFF_SALE';
  return 'DRAFT';
}

function normalizeListLimit(value: unknown): number {
  if (value === undefined) {
    return DEFAULT_LIST_LIMIT;
  }

  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new DomainRuleError(
      'VALIDATION_ERROR',
      `limit must be an integer between ${MIN_LIST_LIMIT} and ${MAX_LIST_LIMIT}`,
      400,
    );
  }

  if (value < MIN_LIST_LIMIT || value > MAX_LIST_LIMIT) {
    throw new DomainRuleError(
      'VALIDATION_ERROR',
      `limit must be between ${MIN_LIST_LIMIT} and ${MAX_LIST_LIMIT}`,
      400,
    );
  }

  return value;
}

function toArtistSummary(artist: StoredArtist): ArtistSummary {
  return {
    id: artist.id,
    name: artist.name,
    memberCount: artist.memberCount,
    createdAt: artist.createdAt,
  };
}

function toProductSummary(product: StoredProduct): ProductSummary {
  return {
    id: product.id,
    artistId: product.artistId,
    category: product.category,
    name: product.name,
    weightG: product.weightG,
    priceKRW: product.priceKRW,
    sku: product.sku,
    barcode: product.barcode,
    avgPurchasePriceKRW: product.avgPurchasePriceKRW,
    stockOnHand: product.stockOnHand,
    orderBasedStock: product.orderBasedStock,
    shipmentBasedStock: product.shipmentBasedStock,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

function toMovementSummary(movement: StoredStockMovement): StockMovementSummary {
  return {
    id: movement.id,
    productId: movement.productId,
    type: movement.type,
    quantity: movement.quantity,
    reason: movement.reason,
    createdById: movement.createdById,
    createdAt: movement.createdAt,
  };
}

function toProductAuditPayload(product: StoredProduct): Record<string, unknown> {
  return {
    artistId: product.artistId,
    category: product.category,
    name: product.name,
    weightG: product.weightG,
    priceKRW: product.priceKRW,
    sku: product.sku,
    barcode: product.barcode,
    avgPurchasePriceKRW: product.avgPurchasePriceKRW,
  };
}
