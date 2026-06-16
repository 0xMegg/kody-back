import { DomainRuleError } from '@/domain/shared/errors.js';
import type {
  CategoryMappingSource,
  CategoryReviewStatus,
  ProductCategory,
  ProductSaleStatus,
  StockMovementType,
} from '@/domain/shared/types.js';
import type { ActionLogWriter } from '@/application/shared/action-log-writer.js';
import { parseReleaseDate, type ImwebMappedProduct, type ImwebProductPriceStatus, type ImwebWarningIssue } from '@/application/product/imweb-product-importer.js';
import {
  buildImwebExportWorkbook,
  dryRunImwebProductWorkbookUpload,
  type ImwebExportWorkbookResult,
  type ImwebExportProductInput,
  type ProductImportDryRunResult,
  type ProductWorkbookUploadInput,
} from '@/application/product/product-excel-workflow.js';

const PRODUCT_CATEGORIES: readonly ProductCategory[] = ['ALBUM', 'PHOTOCARD', 'GOODS'];
const PRODUCT_SALE_STATUSES: readonly ProductSaleStatus[] = ['ON_SALE', 'OFF_SALE', 'SOLD_OUT', 'DRAFT'];
const CATEGORY_MAPPING_SOURCES: readonly CategoryMappingSource[] = ['EXACT', 'FALLBACK', 'MANUAL'];
const CATEGORY_REVIEW_STATUSES: readonly CategoryReviewStatus[] = ['PENDING', 'MAPPED', 'NEEDS_REVIEW'];

const DEFAULT_LIST_LIMIT = 20;
const MIN_LIST_LIMIT = 1;
const MAX_LIST_LIMIT = 100;
const DRY_RUN_EXISTING_PRODUCT_SCAN_LIMIT = 10000;

type ProductPriceStatus = ImwebProductPriceStatus;

export interface ArtistSummary {
  id: string;
  name: string;
  memberCount: number;
  createdAt: Date;
}

export interface ProductExternalMappingSummary {
  id: string;
  productId: string;
  sourceSystem: string;
  externalProductId: string;
  externalUrl: string | null;
  status: string;
  firstSeenAt: Date;
  lastSyncedAt: Date;
}

export interface ProductOptionValueSummary {
  id: string;
  optionId: string;
  value: string;
  position: number;
  priceDeltaKRW: number;
  stockSnapshot: number | null;
}

export interface ProductOptionSummary {
  id: string;
  productId: string;
  name: string;
  position: number;
  values: ProductOptionValueSummary[];
}

export interface ProductSummary {
  id: string;
  artistId: string | null;
  category: ProductCategory | null;
  name: string;
  labelName: string | null;
  thumbnailUrl: string | null;
  detailHtml: string | null;
  externalMappings?: ProductExternalMappingSummary[];
  options?: ProductOptionSummary[];
  releaseDateText: string | null;
  releaseDate: Date | null;
  weightG: number | null;
  priceKRW: string;
  priceStatus: ProductPriceStatus;
  lastConfirmedPriceKRW: string | null;
  lastConfirmedPriceAt: Date | null;
  sourcePriceRaw: string | null;
  sku: string | null;
  barcode: string | null;
  avgPurchasePriceKRW: number;
  stockManaged: boolean;
  stockOnHand: number;
  orderBasedStock: number;
  shipmentBasedStock: number;
  saleStatus: ProductSaleStatus;
  isDisplayed: boolean;
  categoryMappingSource: CategoryMappingSource;
  sourceCategoryCodes: string[];
  categoryReviewStatus: CategoryReviewStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface StockMovementSummary {
  id: string;
  productId: string;
  type: StockMovementType;
  quantity: number;
  previousQty: number | null;
  newQty: number | null;
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
  labelName?: string | null;
  thumbnailUrl?: string | null;
  detailHtml?: string | null;
  releaseDateText?: string | null;
  weightG?: number;
  priceKRW: string | number;
  sku?: string;
  barcode?: string;
  avgPurchasePriceKRW?: number;
  initialStockOnHand?: number;
  stockManaged?: boolean;
  saleStatus?: ProductSaleStatus;
  isDisplayed?: boolean;
  categoryMappingSource?: CategoryMappingSource;
  sourceCategoryCodes?: string[];
  categoryReviewStatus?: CategoryReviewStatus;
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
  artistId?: string | null;
  category?: ProductCategory | null;
  name?: string;
  labelName?: string | null;
  thumbnailUrl?: string | null;
  detailHtml?: string | null;
  releaseDateText?: string | null;
  weightG?: number | null;
  priceKRW?: string | number;
  sku?: string | null;
  barcode?: string | null;
  avgPurchasePriceKRW?: number;
  stockManaged?: boolean;
  saleStatus?: ProductSaleStatus;
  isDisplayed?: boolean;
  categoryMappingSource?: CategoryMappingSource;
  sourceCategoryCodes?: string[];
  categoryReviewStatus?: CategoryReviewStatus;
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
  importRow?: {
    rowIndex: number;
    rawPayload: Record<string, unknown>;
    warnings?: readonly ImwebWarningIssue[];
  };
  rawHash?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface UpsertImwebProductResult {
  status: 'create' | 'update';
  product: ProductSummary;
}

export interface CorrectExternalMappingInput {
  actorUserId: string;
  mappingId: string;
  operation: 'REMAP' | 'DETACH';
  newProductId?: string;
  evidenceUrl: string;
  reason?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface CorrectExternalMappingResult {
  mapping: ProductExternalMappingSummary;
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
  labelName: string | null;
  thumbnailUrl: string | null;
  detailHtml: string | null;
  releaseDateText: string | null;
  releaseDate: Date | null;
  weightG: number | null;
  priceKRW: string;
  priceStatus: ProductPriceStatus;
  lastConfirmedPriceKRW: string | null;
  lastConfirmedPriceAt: Date | null;
  sourcePriceRaw: string | null;
  sku: string | null;
  barcode: string | null;
  avgPurchasePriceKRW: number;
  stockManaged: boolean;
  stockOnHand: number;
  orderBasedStock: number;
  shipmentBasedStock: number;
  saleStatus: ProductSaleStatus;
  isDisplayed: boolean;
  categoryMappingSource: CategoryMappingSource;
  sourceCategoryCodes: string[];
  categoryReviewStatus: CategoryReviewStatus;
  createdAt: Date;
  updatedAt: Date;
}

interface StoredStockMovement {
  id: string;
  productId: string;
  type: StockMovementType;
  quantity: number;
  previousQty: number | null;
  newQty: number | null;
  reason: string | null;
  createdById: string | null;
  createdAt: Date;
}

interface StoredProductExternalMapping {
  id: string;
  productId: string;
  sourceSystem: string;
  externalProductId: string;
  externalUrl: string | null;
  firstSeenAt: Date;
  lastSyncedAt: Date;
  status: string;
}

interface StoredProductOptionValue {
  id: string;
  optionId: string;
  value: string;
  position: number;
  priceDeltaKRW: number;
  stockSnapshot: number | null;
}

interface StoredProductOption {
  id: string;
  productId: string;
  name: string;
  position: number;
  values: StoredProductOptionValue[];
}

interface ProductRepository {
  $transaction<T>(callback: (tx: ProductRepository) => Promise<T>): Promise<T>;
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
      where:
        | { id: string }
        | { sourceSystem_externalProductId: { sourceSystem: string; externalProductId: string } };
    }): Promise<StoredProductExternalMapping | null>;
    findMany(args: {
      where?: { productId?: string; sourceSystem?: string };
      orderBy: Array<Record<string, 'asc' | 'desc'>>;
    }): Promise<StoredProductExternalMapping[]>;
    create(args: { data: Record<string, unknown> }): Promise<StoredProductExternalMapping>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<StoredProductExternalMapping>;
  };
  productOption: {
    deleteMany(args: { where: { productId: string } }): Promise<Record<string, unknown>>;
    create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
    findMany(args: {
      where: { productId: string };
      orderBy: Array<Record<string, 'asc' | 'desc'>>;
      include: { values: { orderBy: Array<Record<string, 'asc' | 'desc'>> } };
    }): Promise<StoredProductOption[]>;
  };
  actionLog: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
  importRow: {
    create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
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
    const labelName =
      input.labelName === undefined ? undefined : input.labelName === null ? null : normalizeOptionalString(input.labelName) ?? null;
    const thumbnailUrl =
      input.thumbnailUrl === undefined
        ? undefined
        : input.thumbnailUrl === null
          ? null
          : normalizeProductThumbnailUrl(input.thumbnailUrl);
    const detailHtml =
      input.detailHtml === undefined ? undefined : input.detailHtml === null ? null : normalizeOptionalHtml(input.detailHtml, 'detailHtml');
    const releaseDateText =
      input.releaseDateText === undefined
        ? undefined
        : input.releaseDateText === null
          ? null
          : normalizeOptionalString(input.releaseDateText) ?? null;
    const releaseDate = releaseDateText === undefined ? undefined : parseReleaseDate(releaseDateText);
    const weightG = input.weightG === undefined ? undefined : normalizeNonNegativeInteger(input.weightG, 'weightG');
    const priceKRW = normalizeNonNegativeDecimal(input.priceKRW, 'priceKRW', 4);
    const sku = input.sku === undefined ? undefined : normalizeOptionalString(input.sku);
    const barcode =
      input.barcode === undefined ? undefined : normalizeOptionalString(input.barcode);
    const avgPurchasePriceKRW =
      input.avgPurchasePriceKRW === undefined
        ? 0
        : normalizeNonNegativeInteger(input.avgPurchasePriceKRW, 'avgPurchasePriceKRW');
    const initialStockOnHand =
      input.initialStockOnHand === undefined
        ? undefined
        : normalizeNonNegativeInteger(input.initialStockOnHand, 'initialStockOnHand');
    const stockManaged =
      input.stockManaged === undefined ? undefined : normalizeBoolean(input.stockManaged, 'stockManaged');
    const saleStatus =
      input.saleStatus === undefined ? undefined : normalizeSaleStatus(input.saleStatus);
    const isDisplayed =
      input.isDisplayed === undefined ? undefined : normalizeBoolean(input.isDisplayed, 'isDisplayed');
    const categoryMappingSource =
      input.categoryMappingSource === undefined
        ? undefined
        : normalizeCategoryMappingSource(input.categoryMappingSource);
    const sourceCategoryCodes =
      input.sourceCategoryCodes === undefined
        ? undefined
        : normalizeStringArray(input.sourceCategoryCodes, 'sourceCategoryCodes');
    const categoryReviewStatus =
      input.categoryReviewStatus === undefined
        ? undefined
        : normalizeCategoryReviewStatus(input.categoryReviewStatus);

    if (artistId !== undefined) {
      await this.findArtist(artistId);
    }

    if (sku) {
      await this.assertSkuAvailable(sku);
    }

    const productId = await this.generateProductId();

    const productData = {
      id: productId,
      ...(artistId !== undefined ? { artistId } : {}),
      ...(category !== undefined ? { category } : {}),
      name,
      ...(labelName !== undefined ? { labelName } : {}),
      ...(thumbnailUrl !== undefined ? { thumbnailUrl } : {}),
      ...(detailHtml !== undefined ? { detailHtml } : {}),
      ...(releaseDateText !== undefined ? { releaseDateText, releaseDate } : {}),
      ...(weightG !== undefined ? { weightG } : {}),
      priceKRW,
      priceStatus: 'CONFIRMED',
      lastConfirmedPriceKRW: priceKRW,
      lastConfirmedPriceAt: new Date(),
      sourcePriceRaw: String(input.priceKRW),
      avgPurchasePriceKRW,
      ...(sku !== undefined ? { sku } : {}),
      ...(barcode !== undefined ? { barcode } : {}),
      ...(initialStockOnHand !== undefined
        ? {
            stockOnHand: initialStockOnHand,
            orderBasedStock: initialStockOnHand,
            shipmentBasedStock: initialStockOnHand,
          }
        : {}),
      ...(stockManaged !== undefined ? { stockManaged } : {}),
      ...(saleStatus !== undefined ? { saleStatus } : {}),
      ...(isDisplayed !== undefined ? { isDisplayed } : {}),
      ...(categoryMappingSource !== undefined ? { categoryMappingSource } : {}),
      ...(sourceCategoryCodes !== undefined ? { sourceCategoryCodes } : {}),
      ...(categoryReviewStatus !== undefined ? { categoryReviewStatus } : {}),
    };

    const created = initialStockOnHand !== undefined && initialStockOnHand > 0
      ? await this.repository.$transaction(async (tx) => {
          const product = await tx.product.create({ data: productData });
          await tx.stockMovement.create({
            data: {
              productId: product.id,
              type: 'INBOUND',
              quantity: initialStockOnHand,
              previousQty: 0,
              newQty: initialStockOnHand,
              reason: 'INITIAL_STOCK',
              createdById: input.actorUserId,
            },
          });
          return product;
        })
      : await this.repository.product.create({ data: productData });

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
      items: sliced.map((product) => toProductSummary(product)),
      nextCursor,
    };
  }

  async dryRunImwebProductWorkbook(input: ProductWorkbookUploadInput): Promise<ProductImportDryRunResult> {
    const [externalMappings, products] = await Promise.all([
      this.repository.productExternalMapping.findMany({
        where: { sourceSystem: 'IMWEB_KR' },
        orderBy: [{ externalProductId: 'asc' }],
      }),
      this.repository.product.findMany({
        orderBy: [{ id: 'asc' }],
        take: DRY_RUN_EXISTING_PRODUCT_SCAN_LIMIT,
      }),
    ]);

    return dryRunImwebProductWorkbookUpload(input, {
      existingExternalProductIds: new Map(
        externalMappings.map((mapping) => [mapping.externalProductId, mapping.productId]),
      ),
      existingSkus: new Map(
        products
          .filter((product) => isPresentString(product.sku))
          .map((product) => [product.sku as string, product.id]),
      ),
      existingBarcodes: new Set(products.map((product) => product.barcode).filter(isPresentString)),
    });
  }

  async exportImwebProducts(productIds: readonly string[]): Promise<ImwebExportWorkbookResult> {
    if (productIds.length === 0) {
      throw new DomainRuleError('EMPTY_PRODUCT_SELECTION', 'productIds must include at least one product id', 400);
    }
    const uniqueProductIds = [...new Set(productIds)];
    const products = await this.repository.product.findMany({
      where: { id: { in: uniqueProductIds } },
      orderBy: [{ id: 'asc' }],
      take: uniqueProductIds.length,
    });
    const foundIds = new Set(products.map((product) => product.id));
    const missingIds = uniqueProductIds.filter((productId) => !foundIds.has(productId));
    if (missingIds.length > 0) {
      throw new DomainRuleError('PRODUCT_NOT_FOUND', `Product not found: ${missingIds.join(', ')}`, 404);
    }

    return buildImwebExportWorkbook(products.map(toProductExportInput));
  }

  async getProduct(productId: string): Promise<ProductSummary> {
    const id = normalizeRequiredString(productId, 'productId');
    const product = await this.findProduct(id);
    const [externalMappings, options] = await Promise.all([
      this.repository.productExternalMapping.findMany({
        where: { productId: id },
        orderBy: [{ sourceSystem: 'asc' }, { externalProductId: 'asc' }],
      }),
      this.repository.productOption.findMany({
        where: { productId: id },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
        include: { values: { orderBy: [{ position: 'asc' }, { id: 'asc' }] } },
      }),
    ]);
    return toProductSummary(product, externalMappings, options);
  }

  async correctExternalMapping(input: CorrectExternalMappingInput): Promise<CorrectExternalMappingResult> {
    const actorUserId = normalizeRequiredString(input.actorUserId, 'actorUserId');
    const mappingId = normalizeRequiredString(input.mappingId, 'mappingId');
    const operation = normalizeExternalMappingOperation(input.operation);
    const evidenceUrl = normalizeHttpsUrl(input.evidenceUrl, 'evidenceUrl');
    const reason = input.reason === undefined ? undefined : normalizeOptionalString(input.reason);
    const newProductId = operation === 'REMAP'
      ? normalizeRequiredString(input.newProductId, 'newProductId')
      : undefined;

    const updated = await this.repository.$transaction(async (tx) => {
      const mapping = await tx.productExternalMapping.findUnique({ where: { id: mappingId } });
      if (!mapping) {
        throw new DomainRuleError('PRODUCT_EXTERNAL_MAPPING_NOT_FOUND', 'External mapping not found', 404);
      }
      if (mapping.status !== 'ACTIVE') {
        throw new DomainRuleError(
          'PRODUCT_EXTERNAL_MAPPING_NOT_ACTIVE',
          'Only ACTIVE external mappings can be corrected',
          409,
        );
      }

      const beforeJson = {
        productId: mapping.productId,
        status: mapping.status,
        sourceSystem: mapping.sourceSystem,
        externalProductId: mapping.externalProductId,
      };

      const data: Record<string, unknown> = {};
      if (operation === 'REMAP') {
        if (!newProductId) {
          throw new DomainRuleError('VALIDATION_ERROR', 'newProductId is required for REMAP', 400);
        }
        if (newProductId === mapping.productId) {
          throw new DomainRuleError(
            'PRODUCT_EXTERNAL_MAPPING_SAME_PRODUCT',
            'newProductId must differ from the current productId',
            409,
          );
        }
        const targetProduct = await tx.product.findUnique({ where: { id: newProductId } });
        if (!targetProduct) {
          throw new DomainRuleError('PRODUCT_NOT_FOUND', 'Target product not found', 404);
        }
        data.productId = newProductId;
      } else {
        data.status = 'ORPHANED';
      }

      const corrected = await tx.productExternalMapping.update({
        where: { id: mappingId },
        data,
      });

      await tx.actionLog.create({
        data: {
          actorUserId,
          actionType: 'PRODUCT_EXTERNAL_MAPPING_CORRECTED',
          targetType: 'ProductExternalMapping',
          targetId: mappingId,
          beforeJson,
          afterJson: {
            productId: corrected.productId,
            status: corrected.status,
            sourceSystem: corrected.sourceSystem,
            externalProductId: corrected.externalProductId,
          },
          metadataJson: {
            operation,
            evidenceUrl,
            reason: reason ?? null,
            sourceSystem: mapping.sourceSystem,
            externalProductId: mapping.externalProductId,
          },
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
        },
      });

      return corrected;
    });

    return { mapping: toExternalMappingSummary(updated) };
  }

  async updateProduct(input: UpdateProductInput): Promise<ProductSummary> {
    const productId = normalizeRequiredString(input.productId, 'productId');
    const current = await this.findProduct(productId);

    const changes: Record<string, unknown> = {};
    const beforeJson: Record<string, unknown> = {};
    const afterJson: Record<string, unknown> = {};

    if (input.artistId !== undefined) {
      const artistId = input.artistId === null ? null : normalizeRequiredString(input.artistId, 'artistId');
      if (artistId !== current.artistId) {
        if (artistId !== null) {
          await this.findArtist(artistId);
        }
        changes.artistId = artistId;
        beforeJson.artistId = current.artistId;
        afterJson.artistId = artistId;
      }
    }

    if (input.category !== undefined) {
      const category = input.category === null ? null : normalizeCategory(input.category);
      if (category !== current.category) {
        changes.category = category;
        beforeJson.category = current.category;
        afterJson.category = category;
      }
    }

    if (input.name !== undefined) {
      const name = normalizeRequiredString(input.name, 'name');
      if (name !== current.name) {
        changes.name = name;
        beforeJson.name = current.name;
        afterJson.name = name;
      }
    }

    if (input.weightG !== undefined) {
      const weightG = input.weightG === null ? null : normalizeNonNegativeInteger(input.weightG, 'weightG');
      if (weightG !== current.weightG) {
        changes.weightG = weightG;
        beforeJson.weightG = current.weightG;
        afterJson.weightG = weightG;
      }
    }

    if (input.priceKRW !== undefined) {
      const priceKRW = normalizeNonNegativeDecimal(input.priceKRW, 'priceKRW', 4);
      if (priceKRW !== decimalToString(current.priceKRW, 4)) {
        changes.priceKRW = priceKRW;
        changes.priceStatus = 'CONFIRMED';
        changes.lastConfirmedPriceKRW = priceKRW;
        changes.lastConfirmedPriceAt = new Date();
        changes.sourcePriceRaw = String(input.priceKRW);
        beforeJson.priceKRW = decimalToString(current.priceKRW, 4);
        beforeJson.priceStatus = current.priceStatus;
        afterJson.priceKRW = priceKRW;
        afterJson.priceStatus = 'CONFIRMED';
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

    if (input.labelName !== undefined) {
      const labelName =
        input.labelName === null ? null : normalizeOptionalString(input.labelName) ?? null;
      if (labelName !== current.labelName) {
        changes.labelName = labelName;
        beforeJson.labelName = current.labelName;
        afterJson.labelName = labelName;
      }
    }

    if (input.thumbnailUrl !== undefined) {
      const thumbnailUrl =
        input.thumbnailUrl === null ? null : normalizeProductThumbnailUrl(input.thumbnailUrl);
      if (thumbnailUrl !== current.thumbnailUrl) {
        changes.thumbnailUrl = thumbnailUrl;
        beforeJson.thumbnailUrl = current.thumbnailUrl;
        afterJson.thumbnailUrl = thumbnailUrl;
      }
    }

    if (input.detailHtml !== undefined) {
      const detailHtml =
        input.detailHtml === null ? null : normalizeOptionalHtml(input.detailHtml, 'detailHtml');
      if (detailHtml !== current.detailHtml) {
        changes.detailHtml = detailHtml;
        beforeJson.detailHtml = current.detailHtml;
        afterJson.detailHtml = detailHtml;
      }
    }

    if (input.releaseDateText !== undefined) {
      const releaseDateText =
        input.releaseDateText === null
          ? null
          : normalizeOptionalString(input.releaseDateText) ?? null;
      const releaseDate = parseReleaseDate(releaseDateText);
      if (releaseDateText !== current.releaseDateText || !datesEqual(releaseDate, current.releaseDate)) {
        changes.releaseDateText = releaseDateText;
        changes.releaseDate = releaseDate;
        beforeJson.releaseDateText = current.releaseDateText;
        beforeJson.releaseDate = current.releaseDate;
        afterJson.releaseDateText = releaseDateText;
        afterJson.releaseDate = releaseDate;
      }
    }

    if (input.stockManaged !== undefined) {
      const stockManaged = normalizeBoolean(input.stockManaged, 'stockManaged');
      if (stockManaged !== current.stockManaged) {
        changes.stockManaged = stockManaged;
        beforeJson.stockManaged = current.stockManaged;
        afterJson.stockManaged = stockManaged;
      }
    }

    if (input.saleStatus !== undefined) {
      const saleStatus = normalizeSaleStatus(input.saleStatus);
      if (saleStatus !== current.saleStatus) {
        changes.saleStatus = saleStatus;
        beforeJson.saleStatus = current.saleStatus;
        afterJson.saleStatus = saleStatus;
      }
    }

    if (input.isDisplayed !== undefined) {
      const isDisplayed = normalizeBoolean(input.isDisplayed, 'isDisplayed');
      if (isDisplayed !== current.isDisplayed) {
        changes.isDisplayed = isDisplayed;
        beforeJson.isDisplayed = current.isDisplayed;
        afterJson.isDisplayed = isDisplayed;
      }
    }

    if (input.categoryMappingSource !== undefined) {
      const categoryMappingSource = normalizeCategoryMappingSource(input.categoryMappingSource);
      if (categoryMappingSource !== current.categoryMappingSource) {
        changes.categoryMappingSource = categoryMappingSource;
        beforeJson.categoryMappingSource = current.categoryMappingSource;
        afterJson.categoryMappingSource = categoryMappingSource;
      }
    }

    if (input.sourceCategoryCodes !== undefined) {
      const sourceCategoryCodes = normalizeStringArray(
        input.sourceCategoryCodes,
        'sourceCategoryCodes',
      );
      if (!stringArraysEqual(sourceCategoryCodes, current.sourceCategoryCodes)) {
        changes.sourceCategoryCodes = sourceCategoryCodes;
        beforeJson.sourceCategoryCodes = [...current.sourceCategoryCodes];
        afterJson.sourceCategoryCodes = sourceCategoryCodes;
      }
    }

    if (input.categoryReviewStatus !== undefined) {
      const categoryReviewStatus = normalizeCategoryReviewStatus(input.categoryReviewStatus);
      if (categoryReviewStatus !== current.categoryReviewStatus) {
        changes.categoryReviewStatus = categoryReviewStatus;
        beforeJson.categoryReviewStatus = current.categoryReviewStatus;
        afterJson.categoryReviewStatus = categoryReviewStatus;
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
    if (mapping) {
      if (mapping.status === 'ORPHANED') {
        throw new DomainRuleError(
          'EXTERNAL_MAPPING_ORPHANED',
          'External mapping is orphaned; correct the mapping before importing this source product',
          409,
        );
      }

      const current = await this.findProduct(mapping.productId);
      const productData = toImwebProductWriteData(input.mapped, current);
      const nextSku = productData.sku as string | null;
      if (nextSku !== null && nextSku !== current.sku) {
        await this.assertSkuAvailable(nextSku, current.id);
      }
      const updated = await this.repository.product.update({
        where: { id: current.id },
        data: productData,
      });
      await this.replaceImwebProductOptions(updated.id, input.mapped);

      const refreshedMapping = await this.repository.productExternalMapping.update({
        where: { id: mapping.id },
        data: toImwebMappingRefreshData(input),
      });

      await this.writeImwebImportRow(input, {
        productId: updated.id,
        mappingId: refreshedMapping.id,
        outcome: 'UPDATED',
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
    const productData = toImwebProductWriteData(input.mapped);
    const nextSku = productData.sku as string | null;
    if (nextSku !== null) {
      await this.assertSkuAvailable(nextSku);
    }
    const created = await this.repository.product.create({
      data: {
        id: productId,
        ...productData,
      },
    });
    await this.replaceImwebProductOptions(created.id, input.mapped);

    const createdMapping = await this.repository.productExternalMapping.create({
      data: {
        productId: created.id,
        sourceSystem: 'IMWEB_KR',
        externalProductId,
        ...toImwebMappingRefreshData(input),
        firstImportBatchId: input.importBatchId ?? null,
      },
    });

    await this.writeImwebImportRow(input, {
      productId: created.id,
      mappingId: createdMapping.id,
      outcome: 'CREATED',
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

  private async replaceImwebProductOptions(productId: string, mapped: ImwebMappedProduct): Promise<void> {
    const optionName = normalizeOptionalString(mapped.optionName);
    const optionValues = mapped.optionValues
      .map((value) => normalizeOptionalString(value))
      .filter((value): value is string => value !== undefined);

    await this.repository.productOption.deleteMany({ where: { productId } });
    if (!optionName || optionValues.length === 0) return;

    await this.repository.productOption.create({
      data: {
        productId,
        name: optionName,
        position: 0,
        values: {
          create: optionValues.map((value, index) => ({
            value,
            position: index,
            priceDeltaKRW: 0,
          })),
        },
      },
    });
  }

  // ── Stock ──────────────────────────────────────────────────────────────────

  async inbound(input: InboundInput): Promise<StockMovementSummary> {
    const productId = normalizeRequiredString(input.productId, 'productId');
    const quantity = normalizeQuantity(input.quantity);

    if (quantity <= 0) {
      throw new DomainRuleError('INVALID_QUANTITY', 'quantity must be positive for inbound', 400);
    }

    const reason = input.reason === undefined ? undefined : normalizeOptionalString(input.reason);

    const { movement, previousQty, newQty } = await this.repository.$transaction(async (tx) => {
      const existing = await tx.product.findUnique({ where: { id: productId } });
      if (!existing) {
        throw new DomainRuleError('PRODUCT_NOT_FOUND', 'Product not found', 404);
      }

      const updated = await tx.product.update({
        where: { id: productId },
        data: {
          stockOnHand: { increment: quantity },
          shipmentBasedStock: { increment: quantity },
        },
      });
      const newQty = updated.stockOnHand;
      const previousQty = newQty - quantity;

      const movement = await tx.stockMovement.create({
        data: {
          productId,
          type: 'INBOUND',
          quantity,
          previousQty,
          newQty,
          ...(reason !== undefined ? { reason } : {}),
          createdById: input.actorUserId,
        },
      });

      return { movement, previousQty, newQty };
    });

    await this.actionLogWriter.write({
      actorUserId: input.actorUserId,
      actionType: 'INVENTORY_INBOUND',
      targetType: 'Product',
      targetId: productId,
      beforeJson: { stockOnHand: previousQty },
      afterJson: { quantity, reason: reason ?? null, previousQty, newQty, movementId: movement.id },
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

    const { movement, previousQty, newQty } = await this.repository.$transaction(async (tx) => {
      const existing = await tx.product.findUnique({ where: { id: productId } });
      if (!existing) {
        throw new DomainRuleError('PRODUCT_NOT_FOUND', 'Product not found', 404);
      }

      const updated = await tx.product.update({
        where: { id: productId },
        data: {
          stockOnHand: { increment: quantity },
          shipmentBasedStock: { increment: quantity },
        },
      });
      const newQty = updated.stockOnHand;
      const previousQty = newQty - quantity;

      const movement = await tx.stockMovement.create({
        data: {
          productId,
          type: 'ADJUSTMENT',
          quantity,
          previousQty,
          newQty,
          reason,
          createdById: input.actorUserId,
        },
      });

      return { movement, previousQty, newQty };
    });

    await this.actionLogWriter.write({
      actorUserId: input.actorUserId,
      actionType: 'INVENTORY_ADJUST',
      targetType: 'Product',
      targetId: productId,
      beforeJson: { stockOnHand: previousQty },
      afterJson: { quantity, reason, previousQty, newQty, movementId: movement.id },
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

  private async writeImwebImportRow(
    input: UpsertImwebProductInput,
    result: { productId: string; mappingId: string; outcome: 'CREATED' | 'UPDATED' },
  ): Promise<void> {
    if (!input.importBatchId || !input.importRow) return;

    const warnings = [...(input.importRow.warnings ?? [])];
    const warningCodes = [...new Set(warnings.map((warning) => warning.code))];
    const reviewRequired = warnings.some(
      (warning) => warning.severity === 'REVIEW' || warning.scope === 'KODY_REVIEW_REQUIRED',
    );

    await this.repository.importRow.create({
      data: {
        batchId: input.importBatchId,
        sourceSystem: 'IMWEB_KR',
        rowIndex: input.importRow.rowIndex,
        externalProductId: input.mapped.externalProductId,
        rawHash: input.rawHash ?? '',
        rawPayload: input.importRow.rawPayload,
        outcome: reviewRequired ? 'NEEDS_REVIEW' : result.outcome,
        sourcePriceRaw: input.mapped.sourcePriceRaw,
        parsedPriceKRW: input.mapped.priceKRW,
        assignedPriceStatus: input.mapped.priceStatus,
        priceReviewReason: reviewRequired ? 'Imported row contains warning(s) requiring KODY review.' : null,
        warnings: warnings.length > 0 ? warnings : undefined,
        warningCodes,
        reviewRequired,
        productId: result.productId,
        mappingId: result.mappingId,
      },
    });
  }

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

function normalizeExternalMappingOperation(value: unknown): 'REMAP' | 'DETACH' {
  if (value !== 'REMAP' && value !== 'DETACH') {
    throw new DomainRuleError('VALIDATION_ERROR', 'operation must be REMAP or DETACH', 400);
  }
  return value;
}

function normalizeHttpsUrl(value: unknown, field: string): string {
  const raw = normalizeRequiredString(value, field);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new DomainRuleError('VALIDATION_ERROR', `${field} must be a valid URL`, 400);
  }
  if (parsed.protocol !== 'https:') {
    throw new DomainRuleError('VALIDATION_ERROR', `${field} must be an https URL`, 400);
  }
  return parsed.toString();
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

function normalizeOptionalHtml(value: unknown, field: string): string | null {
  if (typeof value !== 'string') {
    throw new DomainRuleError('VALIDATION_ERROR', `${field} must be a string`, 400);
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }
  if (trimmed.length > 200_000) {
    throw new DomainRuleError('VALIDATION_ERROR', `${field} must be 200000 characters or fewer`, 400);
  }
  const sanitized = sanitizeProductDetailHtml(trimmed);
  return sanitized === '' ? null : sanitized;
}

const ALLOWED_DETAIL_HTML_TAGS: ReadonlySet<string> = new Set([
  'p', 'br', 'strong', 'b', 'span', 'img', 'div', 'ul', 'ol', 'li',
]);
const VOID_DETAIL_HTML_TAGS: ReadonlySet<string> = new Set(['br', 'img']);
const ALLOWED_DETAIL_IMG_ATTRS: ReadonlySet<string> = new Set(['src', 'alt', 'class', 'style']);
const ALLOWED_DETAIL_DEFAULT_ATTRS: ReadonlySet<string> = new Set(['class', 'style']);
const ALLOWED_DETAIL_STYLE_PROPS: ReadonlySet<string> = new Set([
  'text-align', 'font-size', 'width', 'display',
]);

interface SanitizedAttribute {
  name: string;
  value: string;
}

function sanitizeProductDetailHtml(input: string): string {
  const out: string[] = [];
  const stack: string[] = [];
  const len = input.length;
  let i = 0;

  while (i < len) {
    if (input[i] !== '<') {
      const next = input.indexOf('<', i);
      out.push(next < 0 ? input.substring(i) : input.substring(i, next));
      if (next < 0) break;
      i = next;
      continue;
    }

    if (input.startsWith('<!--', i)) {
      const end = input.indexOf('-->', i + 4);
      i = end < 0 ? len : end + 3;
      continue;
    }
    if (input[i + 1] === '!' || input[i + 1] === '?') {
      const end = input.indexOf('>', i);
      i = end < 0 ? len : end + 1;
      continue;
    }
    if (input[i + 1] === '/') {
      const closeMatch = /^<\/([a-zA-Z][a-zA-Z0-9]*)[^>]*>/.exec(input.substring(i));
      if (!closeMatch) {
        i += 1;
        continue;
      }
      i += closeMatch[0].length;
      const tag = closeMatch[1].toLowerCase();
      if (!ALLOWED_DETAIL_HTML_TAGS.has(tag) || VOID_DETAIL_HTML_TAGS.has(tag)) continue;
      const idx = stack.lastIndexOf(tag);
      if (idx < 0) continue;
      while (stack.length > idx) {
        const popped = stack.pop();
        if (popped !== undefined) out.push(`</${popped}>`);
      }
      continue;
    }

    const openMatch = /^<([a-zA-Z][a-zA-Z0-9]*)([^>]*?)(\/?)>/.exec(input.substring(i));
    if (!openMatch) {
      i += 1;
      continue;
    }
    i += openMatch[0].length;
    const tag = openMatch[1].toLowerCase();
    const rawAttrs = openMatch[2];
    const isVoid = VOID_DETAIL_HTML_TAGS.has(tag);
    const selfClosed = openMatch[3] === '/' || isVoid;

    if (!ALLOWED_DETAIL_HTML_TAGS.has(tag)) continue;

    const attrs = sanitizeDetailAttributes(tag, rawAttrs);
    if (tag === 'img') {
      const src = attrs.find((attr) => attr.name === 'src');
      if (!src || !isSafeDetailImageUrl(src.value)) continue;
    }

    const attrText = attrs
      .map((attr) => ` ${attr.name}="${escapeHtmlAttribute(attr.value)}"`)
      .join('');

    out.push(`<${tag}${attrText}>`);
    if (!selfClosed) stack.push(tag);
  }

  while (stack.length > 0) {
    const popped = stack.pop();
    if (popped !== undefined) out.push(`</${popped}>`);
  }

  return out.join('').trim();
}

function sanitizeDetailAttributes(tag: string, raw: string): SanitizedAttribute[] {
  const allowed = tag === 'img' ? ALLOWED_DETAIL_IMG_ATTRS : ALLOWED_DETAIL_DEFAULT_ATTRS;
  const attrs: SanitizedAttribute[] = [];
  const seen = new Set<string>();
  const re = /\s*([^\s=>"'/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw)) !== null) {
    const name = match[1].toLowerCase();
    if (name.startsWith('on')) continue;
    if (!allowed.has(name)) continue;
    if (seen.has(name)) continue;
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    if (name === 'style') {
      const safeStyle = sanitizeDetailStyle(value);
      if (!safeStyle) continue;
      attrs.push({ name, value: safeStyle });
      seen.add(name);
      continue;
    }
    attrs.push({ name, value });
    seen.add(name);
  }
  return attrs;
}

function sanitizeDetailStyle(raw: string): string {
  const decls = raw.split(';');
  const safe: string[] = [];
  for (const decl of decls) {
    const trimmed = decl.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(':');
    if (colon < 0) continue;
    const prop = trimmed.substring(0, colon).trim().toLowerCase();
    const value = trimmed.substring(colon + 1).trim();
    if (!prop || !value) continue;
    if (!ALLOWED_DETAIL_STYLE_PROPS.has(prop)) continue;
    if (!isSafeStyleValue(value)) continue;
    safe.push(`${prop}: ${value};`);
  }
  return safe.join(' ');
}

function isSafeStyleValue(value: string): boolean {
  if (/[<>"']/.test(value)) return false;
  if (/url\s*\(/i.test(value)) return false;
  if (/expression\s*\(/i.test(value)) return false;
  if (/javascript\s*:/i.test(value)) return false;
  return true;
}

function isSafeDetailImageUrl(src: string): boolean {
  if (src.startsWith('/api/uploads/')) return true;
  if (!src.startsWith('https://')) return false;
  try {
    const url = new URL(src);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizeProductThumbnailUrl(value: unknown): string | null {
  if (typeof value !== 'string') {
    throw new DomainRuleError('VALIDATION_ERROR', 'thumbnailUrl must be a string', 400);
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }
  if (trimmed.length > 2048) {
    throw new DomainRuleError('VALIDATION_ERROR', 'thumbnailUrl must be 2048 characters or fewer', 400);
  }
  if (trimmed.startsWith('/api/uploads/product-detail-images/')) {
    return trimmed;
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new DomainRuleError('VALIDATION_ERROR', 'thumbnailUrl must be a valid URL', 400);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new DomainRuleError('VALIDATION_ERROR', 'thumbnailUrl must use http or https', 400);
  }
  return parsed.toString();
}

function isPresentString(value: string | null): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function normalizeAllowedHttpUrl(value: unknown): string | null {
  const normalized = normalizeOptionalString(value);
  if (normalized === undefined) {
    return null;
  }

  try {
    const url = new URL(normalized);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
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

function normalizeSaleStatus(value: unknown): ProductSaleStatus {
  if (typeof value !== 'string' || !PRODUCT_SALE_STATUSES.includes(value as ProductSaleStatus)) {
    throw new DomainRuleError(
      'VALIDATION_ERROR',
      `saleStatus must be one of: ${PRODUCT_SALE_STATUSES.join(', ')}`,
      400,
    );
  }

  return value as ProductSaleStatus;
}

function normalizeCategoryMappingSource(value: unknown): CategoryMappingSource {
  if (
    typeof value !== 'string' ||
    !CATEGORY_MAPPING_SOURCES.includes(value as CategoryMappingSource)
  ) {
    throw new DomainRuleError(
      'VALIDATION_ERROR',
      `categoryMappingSource must be one of: ${CATEGORY_MAPPING_SOURCES.join(', ')}`,
      400,
    );
  }

  return value as CategoryMappingSource;
}

function normalizeCategoryReviewStatus(value: unknown): CategoryReviewStatus {
  if (
    typeof value !== 'string' ||
    !CATEGORY_REVIEW_STATUSES.includes(value as CategoryReviewStatus)
  ) {
    throw new DomainRuleError(
      'VALIDATION_ERROR',
      `categoryReviewStatus must be one of: ${CATEGORY_REVIEW_STATUSES.join(', ')}`,
      400,
    );
  }

  return value as CategoryReviewStatus;
}

function normalizeBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new DomainRuleError('VALIDATION_ERROR', `${field} must be a boolean`, 400);
  }

  return value;
}

function normalizeStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new DomainRuleError('VALIDATION_ERROR', `${field} must be an array of strings`, 400);
  }

  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.trim() === '') {
      throw new DomainRuleError(
        'VALIDATION_ERROR',
        `${field} must contain only non-empty strings`,
        400,
      );
    }
    result.push(entry.trim());
  }

  return result;
}

function stringArraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
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

function normalizeNonNegativeDecimal(value: unknown, field: string, scale: number): string {
  const raw = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.replace(/,/g, '').trim() : '';
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw)) {
    throw new DomainRuleError('VALIDATION_ERROR', `${field} must be a non-negative decimal`, 400);
  }
  const [integerPart, fractionalPart = ''] = raw.split('.');
  if (fractionalPart.length > scale) {
    throw new DomainRuleError('VALIDATION_ERROR', `${field} must have at most ${scale} decimal places`, 400);
  }
  return `${integerPart}.${fractionalPart.padEnd(scale, '0')}`;
}

function decimalToString(value: unknown, scale = 4): string {
  const raw = typeof value === 'object' && value !== null && 'toFixed' in value
    ? (value as { toFixed: (digits: number) => string }).toFixed(scale)
    : String(value);
  const [integerPart, fractionalPart = ''] = raw.split('.');
  return `${integerPart}.${fractionalPart.padEnd(scale, '0').slice(0, scale)}`;
}

function normalizeQuantity(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new DomainRuleError('INVALID_QUANTITY', 'quantity must be an integer', 400);
  }

  return value;
}

function toImwebProductWriteData(mapped: ImwebMappedProduct, current?: StoredProduct): Record<string, unknown> {
  const priceFields = toImwebPriceWriteData(mapped, current);
  const thumbnailUrl = normalizeOptionalString(mapped.thumbnailUrl);
  const detailHtml = normalizeOptionalString(mapped.detailHtml);
  const releaseDateText = normalizeOptionalString(mapped.releaseDateText) ?? null;
  const releaseDate = mapped.releaseDate ?? parseReleaseDate(releaseDateText);
  return {
    category: mapped.category,
    categoryMappingSource: mapped.categoryMappingSource,
    sourceCategoryCodes: mapped.rawCategoryIds,
    categoryReviewStatus: mapped.category === null ? 'NEEDS_REVIEW' : 'MAPPED',
    name: mapped.name,
    labelName: normalizeOptionalString(mapped.artistName) ?? null,
    releaseDateText,
    releaseDate,
    ...(thumbnailUrl !== undefined ? { thumbnailUrl } : {}),
    ...(detailHtml !== undefined ? { detailHtml } : {}),
    weightG: mapped.weightG,
    ...priceFields,
    sku: normalizeOptionalString(mapped.sku) ?? null,
    barcode: normalizeOptionalString(mapped.barcode) ?? null,
    stockOnHand: mapped.stockOnHand,
    avgPurchasePriceKRW: mapped.avgPurchasePriceKRW,
    saleStatus: mapped.priceStatus === 'CONFIRMED' ? toProductSaleStatus(mapped.saleStatus) : 'OFF_SALE',
    isDisplayed: mapped.displayStatus,
  };
}

function toImwebPriceWriteData(mapped: ImwebMappedProduct, current?: StoredProduct): Record<string, unknown> {
  if (mapped.priceStatus === 'CONFIRMED') {
    return {
      priceKRW: mapped.priceKRW,
      priceStatus: 'CONFIRMED',
      lastConfirmedPriceKRW: mapped.priceKRW,
      lastConfirmedPriceAt: new Date(),
      sourcePriceRaw: mapped.sourcePriceRaw,
    };
  }

  if (current?.priceStatus === 'CONFIRMED') {
    const lastConfirmedPriceKRW = current.lastConfirmedPriceKRW ?? decimalToString(current.priceKRW, 4);
    return {
      priceKRW: decimalToString(current.priceKRW, 4),
      priceStatus: 'STALE_NEEDS_RECONFIRM',
      lastConfirmedPriceKRW,
      lastConfirmedPriceAt: current.lastConfirmedPriceAt ?? null,
      sourcePriceRaw: mapped.sourcePriceRaw,
    };
  }

  return {
    priceKRW: mapped.priceKRW,
    priceStatus: mapped.priceStatus,
    lastConfirmedPriceKRW: current?.lastConfirmedPriceKRW ?? null,
    lastConfirmedPriceAt: current?.lastConfirmedPriceAt ?? null,
    sourcePriceRaw: mapped.sourcePriceRaw,
  };
}

function toImwebMappingRefreshData(input: UpsertImwebProductInput): Record<string, unknown> {
  return {
    externalUrl: normalizeAllowedHttpUrl(input.mapped.productUrl),
    lastImportBatchId: input.importBatchId ?? null,
    lastRawHash: input.rawHash ?? null,
    status: 'ACTIVE',
  };
}

function toProductSaleStatus(value: string | null): ProductSaleStatus {
  if (value === '판매중') return 'ON_SALE';
  if (value === '품절') return 'SOLD_OUT';
  if (value === '판매안함' || value === '판매중지' || value === '숨김') return 'OFF_SALE';
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

function toProductSummary(
  product: StoredProduct,
  externalMappings?: readonly StoredProductExternalMapping[],
  options?: readonly StoredProductOption[],
): ProductSummary {
  return {
    id: product.id,
    artistId: product.artistId,
    category: product.category,
    name: product.name,
    labelName: product.labelName,
    thumbnailUrl: product.thumbnailUrl,
    detailHtml: product.detailHtml,
    ...(externalMappings !== undefined ? { externalMappings: externalMappings.map(toExternalMappingSummary) } : {}),
    ...(options !== undefined ? { options: options.map(toProductOptionSummary) } : {}),
    releaseDateText: product.releaseDateText,
    releaseDate: product.releaseDate,
    weightG: product.weightG,
    priceKRW: decimalToString(product.priceKRW, 4),
    priceStatus: product.priceStatus,
    lastConfirmedPriceKRW: product.lastConfirmedPriceKRW == null ? null : decimalToString(product.lastConfirmedPriceKRW, 4),
    lastConfirmedPriceAt: product.lastConfirmedPriceAt,
    sourcePriceRaw: product.sourcePriceRaw,
    sku: product.sku,
    barcode: product.barcode,
    avgPurchasePriceKRW: product.avgPurchasePriceKRW,
    stockManaged: product.stockManaged,
    stockOnHand: product.stockOnHand,
    orderBasedStock: product.orderBasedStock,
    shipmentBasedStock: product.shipmentBasedStock,
    saleStatus: product.saleStatus,
    isDisplayed: product.isDisplayed,
    categoryMappingSource: product.categoryMappingSource,
    sourceCategoryCodes: [...product.sourceCategoryCodes],
    categoryReviewStatus: product.categoryReviewStatus,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}


function toProductOptionSummary(option: StoredProductOption): ProductOptionSummary {
  return {
    id: option.id,
    productId: option.productId,
    name: option.name,
    position: option.position,
    values: option.values.map((value) => ({
      id: value.id,
      optionId: value.optionId,
      value: value.value,
      position: value.position,
      priceDeltaKRW: value.priceDeltaKRW,
      stockSnapshot: value.stockSnapshot,
    })),
  };
}

function datesEqual(left: Date | null, right: Date | null): boolean {
  if (left === null || right === null) return left === right;
  return left.getTime() === right.getTime();
}

function toExternalMappingSummary(mapping: StoredProductExternalMapping): ProductExternalMappingSummary {
  return {
    id: mapping.id,
    productId: mapping.productId,
    sourceSystem: mapping.sourceSystem,
    externalProductId: mapping.externalProductId,
    externalUrl: mapping.externalUrl,
    status: mapping.status,
    firstSeenAt: mapping.firstSeenAt,
    lastSyncedAt: mapping.lastSyncedAt,
  };
}

function toProductExportInput(product: StoredProduct): ImwebExportProductInput {
  return {
    id: product.id,
    name: product.name,
    labelName: product.labelName,
    releaseDateText: product.releaseDateText,
    weightG: product.weightG,
    priceKRW: decimalToString(product.priceKRW, 4),
    sku: product.sku,
    barcode: product.barcode,
    stockOnHand: product.stockOnHand,
    stockManaged: product.stockManaged,
    saleStatus: product.saleStatus,
    isDisplayed: product.isDisplayed,
    sourceCategoryCodes: [...product.sourceCategoryCodes],
  };
}

function toMovementSummary(movement: StoredStockMovement): StockMovementSummary {
  return {
    id: movement.id,
    productId: movement.productId,
    type: movement.type,
    quantity: movement.quantity,
    previousQty: movement.previousQty,
    newQty: movement.newQty,
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
    labelName: product.labelName,
    thumbnailUrl: product.thumbnailUrl,
    detailHtml: product.detailHtml,
    releaseDateText: product.releaseDateText,
    releaseDate: product.releaseDate,
    weightG: product.weightG,
    priceKRW: decimalToString(product.priceKRW, 4),
    priceStatus: product.priceStatus,
    lastConfirmedPriceKRW: product.lastConfirmedPriceKRW == null ? null : decimalToString(product.lastConfirmedPriceKRW, 4),
    sourcePriceRaw: product.sourcePriceRaw,
    sku: product.sku,
    barcode: product.barcode,
    avgPurchasePriceKRW: product.avgPurchasePriceKRW,
    stockManaged: product.stockManaged,
    saleStatus: product.saleStatus,
    isDisplayed: product.isDisplayed,
    categoryMappingSource: product.categoryMappingSource,
    sourceCategoryCodes: [...product.sourceCategoryCodes],
    categoryReviewStatus: product.categoryReviewStatus,
  };
}
