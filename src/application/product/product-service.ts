import { DomainRuleError } from '@/domain/shared/errors.js';
import type {
  CategoryMappingSource,
  CategoryReviewStatus,
  OrderStatus,
  ProductCategory,
  ProductCategoryMinor,
  ProductItemType,
  ProductPublicSaleWindowStatus,
  ProductSaleStatus,
  ShipmentItemStatus,
  StockMovementType,
} from '@/domain/shared/types.js';
import { ActionLogWriter, type ActionLogRepository } from '@/application/shared/action-log-writer.js';
import { parseReleaseDate, type ImwebMappedProduct, type ImwebProductPriceStatus, type ImwebWarningIssue } from '@/application/product/imweb-product-importer.js';
import {
  buildImwebExportWorkbook,
  dryRunImwebProductWorkbookUpload,
  type ImwebExportWorkbookResult,
  type ImwebExportProductInput,
  type ProductImportDryRunResult,
  type ProductWorkbookUploadInput,
} from '@/application/product/product-excel-workflow.js';
import {
  assertUniqueNonNullVariantSkusPerProduct,
  InvalidSaleWindowError,
  resolveEffectiveVariantIdentity,
  resolveEffectiveVariantSaleWindow,
  resolveVariantPriceAuthority,
  VARIANT_SELLABLE_ACTION_LOG_SCOPE,
} from '@/domain/product/variant-sellable-contract.js';

const PRODUCT_CATEGORIES: readonly ProductCategory[] = ['ALBUM', 'PHOTOCARD', 'GOODS', 'MAGAZINE', 'SEASON_GREETINGS'];
const PRODUCT_CATEGORY_MINORS: readonly ProductCategoryMinor[] = ['BOY_GROUP', 'GIRL_GROUP', 'SOLO', 'JAPANESE_ALBUM', 'OST', 'OFFICIAL_GOODS', 'FANDOM_GOODS'];
const PRODUCT_ITEM_TYPES: readonly ProductItemType[] = ['LIGHT_STICK', 'MD', 'PHOTOBOOK', 'PHOTO_CARD', 'MUSIC_SHEET', 'SANRIO', 'HOLDER', 'COLLECT_BOOK', 'STICKER'];
const ALBUM_CATEGORY_MINORS: readonly ProductCategoryMinor[] = ['BOY_GROUP', 'GIRL_GROUP', 'SOLO', 'JAPANESE_ALBUM', 'OST'];
const OFFICIAL_GOODS_ITEM_TYPES: readonly ProductItemType[] = ['LIGHT_STICK', 'MD', 'PHOTOBOOK', 'PHOTO_CARD', 'MUSIC_SHEET'];
const FANDOM_GOODS_ITEM_TYPES: readonly ProductItemType[] = ['SANRIO', 'HOLDER', 'COLLECT_BOOK', 'STICKER'];
const PRODUCT_SALE_STATUSES: readonly ProductSaleStatus[] = ['ON_SALE', 'OFF_SALE', 'SOLD_OUT', 'DRAFT'];
const CATEGORY_MAPPING_SOURCES: readonly CategoryMappingSource[] = ['EXACT', 'FALLBACK', 'MANUAL'];
const CATEGORY_REVIEW_STATUSES: readonly CategoryReviewStatus[] = ['PENDING', 'MAPPED', 'NEEDS_REVIEW'];

const DEFAULT_LIST_LIMIT = 20;
const MIN_LIST_LIMIT = 1;
const MAX_LIST_LIMIT = 100;
const DRY_RUN_EXISTING_PRODUCT_SCAN_LIMIT = 10000;
const OPEN_ORDER_STATUS: OrderStatus = 'CONFIRMED';
const FULFILLED_SHIPMENT_STATUS: ShipmentItemStatus = 'COMPLETED';

type ProductPriceStatus = ImwebProductPriceStatus;

export type ProductDisplayStatus = 'ON_SALE' | 'SOLD_OUT' | 'HIDDEN' | 'DRAFT';

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

export interface ProductVariantSummary {
  id: string;
  productId: string;
  name: string;
  optionValueIds: string[];
  sku: string | null;
  barcode: string | null;
  effectiveSku: string | null;
  effectiveBarcode: string | null;
  skuInherited: boolean;
  barcodeInherited: boolean;
  priceKRW: string;
  effectivePriceKRW: string;
  priceAuthority: 'VARIANT' | 'PRODUCT';
  saleStartAt: Date | null;
  saleEndAt: Date | null;
  effectiveSaleStartAt: Date | null;
  effectiveSaleEndAt: Date | null;
  saleWindowInheritedFromProduct: boolean;
  saleWindowEmpty: boolean;
  position: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Human write-path payload for a single product variant. Stock fields are
 * intentionally absent: A-1 variants carry no inventory authority.
 */
export interface VariantWriteInput {
  id?: string;
  name: string;
  optionValueIds?: string[];
  sku?: string | null;
  barcode?: string | null;
  priceKRW: string | number;
  saleStartAt?: string | null;
  saleEndAt?: string | null;
  position?: number;
}

export interface ProductSummary {
  id: string;
  artistId: string | null;
  category: ProductCategory | null;
  categoryMinor?: ProductCategoryMinor | null;
  itemType?: ProductItemType | null;
  name: string;
  labelName: string | null;
  thumbnailUrl: string | null;
  detailHtml: string | null;
  externalMappings?: ProductExternalMappingSummary[];
  options?: ProductOptionSummary[];
  variants?: ProductVariantSummary[];
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
  openOrderedQuantity: number;
  saleStatus: ProductSaleStatus;
  isDisplayed: boolean;
  displayStatus: ProductDisplayStatus;
  priceUSD: number | null;
  categoryMappingSource: CategoryMappingSource;
  sourceCategoryCodes: string[];
  categoryReviewStatus: CategoryReviewStatus;
  categoryArtist: string | null;
  categoryArtistDetail: string | null;
  categoryType: string | null;
  categoryTypeDetail: string | null;
  categoryArtistCandidates: string[];
  categoryArtistDetailCandidates: string[];
  categoryTypeCandidates: string[];
  categoryTypeDetailCandidates: string[];
  categoryProjectionMeta: unknown | null;
  publicSaleStartsAt: Date | null;
  publicSaleEndsAt: Date | null;
  publicSaleWindowStatus: ProductPublicSaleWindowStatus;
  publicSaleWindowUpdatedByUserId: string | null;
  publicSaleWindowUpdatedAt: Date | null;
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
  categoryMinor?: ProductCategoryMinor | null;
  itemType?: ProductItemType | null;
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
  variants?: VariantWriteInput[];
  ipAddress?: string;
  userAgent?: string;
}

export interface ListProductsInput {
  artistId?: string;
  category?: ProductCategory;
  categoryMinor?: ProductCategoryMinor;
  itemType?: ProductItemType;
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
  categoryMinor?: ProductCategoryMinor | null;
  itemType?: ProductItemType | null;
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
  variants?: VariantWriteInput[];
  ipAddress?: string;
  userAgent?: string;
}

export interface UpdateProductPublicSaleWindowInput {
  actorUserId: string;
  productId: string;
  publicSaleStartsAt?: string | null;
  publicSaleEndsAt?: string | null;
  publicSaleWindowStatus: ProductPublicSaleWindowStatus;
  reason?: string;
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
  categoryMinor: ProductCategoryMinor | null;
  itemType: ProductItemType | null;
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
  categoryArtist: string | null;
  categoryArtistDetail: string | null;
  categoryType: string | null;
  categoryTypeDetail: string | null;
  categoryArtistCandidates: string[];
  categoryArtistDetailCandidates: string[];
  categoryTypeCandidates: string[];
  categoryTypeDetailCandidates: string[];
  categoryProjectionMeta: unknown | null;
  publicSaleStartsAt: Date | null;
  publicSaleEndsAt: Date | null;
  publicSaleWindowStatus: ProductPublicSaleWindowStatus;
  publicSaleWindowUpdatedByUserId: string | null;
  publicSaleWindowUpdatedAt: Date | null;
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

interface StoredProductVariant {
  id: string;
  productId: string;
  name: string;
  optionValueIds: string[];
  sku: string | null;
  barcode: string | null;
  priceKRW: string;
  saleStartAt: Date | null;
  saleEndAt: Date | null;
  position: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Normalized, validated variant ready to persist. */
interface NormalizedVariant {
  id?: string;
  name: string;
  optionValueIds: string[];
  sku: string | null;
  barcode: string | null;
  priceKRW: string;
  saleStartAt: Date | null;
  saleEndAt: Date | null;
  position?: number;
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
  productOptionValue: {
    deleteMany(args: { where: { option: { productId: string } } }): Promise<Record<string, unknown>>;
  };
  productVariant?: {
    findMany(args: {
      where: { productId: string };
      orderBy: Array<Record<string, 'asc' | 'desc'>>;
    }): Promise<StoredProductVariant[]>;
    create(args: { data: Record<string, unknown> }): Promise<StoredProductVariant>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<StoredProductVariant>;
    deleteMany(args: {
      where: { id: { in: string[] }; productId: string };
    }): Promise<Record<string, unknown>>;
  };
  actionLog: ActionLogRepository;
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
  orderItem?: {
    groupBy(args: {
      by: ['productId'];
      where: {
        productId: { in: string[] };
        order: { status: OrderStatus };
        shipmentStatus: { not: ShipmentItemStatus };
      };
      _sum: { quantity: true };
    }): Promise<Array<{ productId: string; _sum: { quantity: number | null } }>>;
  };
  fxRate?: {
    findFirst(args: {
      where: Record<string, unknown>;
      orderBy: Array<Record<string, 'asc' | 'desc'>>;
    }): Promise<{ rateToKRW: unknown } | null>;
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
    const categoryMinor = input.categoryMinor === undefined ? undefined : normalizeNullableCategoryMinor(input.categoryMinor);
    const itemType = input.itemType === undefined ? undefined : normalizeNullableItemType(input.itemType);
    validateProductTaxonomy(category ?? null, categoryMinor ?? null, itemType ?? null);
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
    const variantInputs =
      input.variants === undefined ? undefined : normalizeVariantWriteInputs(input.variants);
    if (variantInputs !== undefined) {
      assertVariantSkuUniqueness(variantInputs);
    }

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
      ...(categoryMinor !== undefined ? { categoryMinor } : {}),
      ...(itemType !== undefined ? { itemType } : {}),
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

    const hasInitialStock = initialStockOnHand !== undefined && initialStockOnHand > 0;
    const hasVariants = variantInputs !== undefined && variantInputs.length > 0;

    let created: StoredProduct;
    let createdVariants: StoredProductVariant[] | undefined;
    if (hasInitialStock || hasVariants) {
      const result = await this.repository.$transaction(async (tx) => {
        const product = await tx.product.create({ data: productData });
        if (hasInitialStock) {
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
        }
        const variants =
          variantInputs === undefined
            ? undefined
            : await this.createProductVariants(product.id, variantInputs, tx);
        return { product, variants };
      });
      created = result.product;
      createdVariants = result.variants;
    } else {
      created = await this.repository.product.create({ data: productData });
      // Present-but-empty variants list still produces an (empty) projection.
      createdVariants = variantInputs === undefined ? undefined : [];
    }

    await this.actionLogWriter.write({
      actorUserId: input.actorUserId,
      actionType: 'PRODUCT_CREATE',
      targetType: 'Product',
      targetId: created.id,
      afterJson: {
        ...toProductAuditPayload(created),
        ...(createdVariants !== undefined
          ? { variants: createdVariants.map((variant) => toVariantAuditPayload(variant, created)) }
          : {}),
      },
      ...(createdVariants !== undefined ? { metadataJson: { scope: VARIANT_SELLABLE_ACTION_LOG_SCOPE } } : {}),
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    return toProductSummary(
      created,
      undefined,
      undefined,
      await this.getLatestUsdRateToKRW(),
      0,
      createdVariants,
    );
  }

  async listProducts(input: ListProductsInput): Promise<ListProductsResult> {
    const limit = normalizeListLimit(input.limit);
    const cursor = normalizeOptionalString(input.cursor);
    const artistId = normalizeOptionalString(input.artistId);
    const q = normalizeOptionalString(input.q);
    const category = input.category === undefined ? undefined : normalizeCategory(input.category);
    const categoryMinor = input.categoryMinor === undefined ? undefined : normalizeCategoryMinor(input.categoryMinor);
    const itemType = input.itemType === undefined ? undefined : normalizeItemType(input.itemType);

    const where: Record<string, unknown> = {};

    if (artistId) {
      where.artistId = artistId;
    }
    if (category) {
      where.category = category;
    }
    if (categoryMinor) {
      where.categoryMinor = categoryMinor;
    }
    if (itemType) {
      where.itemType = itemType;
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

    const [usdRateToKRW, openOrderedQuantities] = await Promise.all([
      this.getLatestUsdRateToKRW(),
      this.computeOpenOrderedQuantities(sliced.map((product) => product.id)),
    ]);

    return {
      items: sliced.map((product) =>
        toProductSummary(
          product,
          undefined,
          undefined,
          usdRateToKRW,
          openOrderedQuantities.get(product.id) ?? 0,
        ),
      ),
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
    const [externalMappings, options, variants, usdRateToKRW, openOrderedQuantities] = await Promise.all([
      this.repository.productExternalMapping.findMany({
        where: { productId: id },
        orderBy: [{ sourceSystem: 'asc' }, { externalProductId: 'asc' }],
      }),
      this.repository.productOption.findMany({
        where: { productId: id },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
        include: { values: { orderBy: [{ position: 'asc' }, { id: 'asc' }] } },
      }),
      this.repository.productVariant
        ? this.repository.productVariant.findMany({
            where: { productId: id },
            orderBy: [{ position: 'asc' }, { id: 'asc' }],
          })
        : Promise.resolve(undefined),
      this.getLatestUsdRateToKRW(),
      this.computeOpenOrderedQuantities([id]),
    ]);
    return toProductSummary(
      product,
      externalMappings,
      options,
      usdRateToKRW,
      openOrderedQuantities.get(id) ?? 0,
      variants,
    );
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

    if (input.categoryMinor !== undefined) {
      const categoryMinor = normalizeNullableCategoryMinor(input.categoryMinor);
      if (categoryMinor !== current.categoryMinor) {
        changes.categoryMinor = categoryMinor;
        beforeJson.categoryMinor = current.categoryMinor;
        afterJson.categoryMinor = categoryMinor;
      }
    }

    if (input.itemType !== undefined) {
      const itemType = normalizeNullableItemType(input.itemType);
      if (itemType !== current.itemType) {
        changes.itemType = itemType;
        beforeJson.itemType = current.itemType;
        afterJson.itemType = itemType;
      }
    }

    const nextCategory = input.category !== undefined
      ? (input.category === null ? null : normalizeCategory(input.category))
      : current.category;
    const nextCategoryMinor = input.categoryMinor !== undefined
      ? normalizeNullableCategoryMinor(input.categoryMinor)
      : current.categoryMinor ?? null;
    const nextItemType = input.itemType !== undefined
      ? normalizeNullableItemType(input.itemType)
      : current.itemType ?? null;

    validateProductTaxonomy(nextCategory, nextCategoryMinor, nextItemType);

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

    const variantInputs =
      input.variants === undefined ? undefined : normalizeVariantWriteInputs(input.variants);
    if (variantInputs !== undefined) {
      assertVariantSkuUniqueness(variantInputs);
    }
    const hasFieldChanges = Object.keys(changes).length > 0;

    // Absent variants AND no field changes is a no-op: leave everything untouched.
    if (!hasFieldChanges && variantInputs === undefined) {
      return toProductSummary(current, undefined, undefined, await this.getLatestUsdRateToKRW());
    }

    let updated: StoredProduct;
    let afterVariants: StoredProductVariant[] | undefined;
    if (variantInputs !== undefined) {
      const result = await this.repository.$transaction(async (tx) => {
        const product = hasFieldChanges
          ? await tx.product.update({ where: { id: productId }, data: changes })
          : current;
        const reconcile = await this.reconcileProductVariants(productId, variantInputs, tx);
        return { product, reconcile };
      });
      updated = result.product;
      afterVariants = result.reconcile.after;
      beforeJson.variants = result.reconcile.before.map((variant) => toVariantAuditPayload(variant, current));
      afterJson.variants = result.reconcile.after.map((variant) => toVariantAuditPayload(variant, updated));
    } else {
      updated = await this.repository.product.update({
        where: { id: productId },
        data: changes,
      });
    }

    await this.actionLogWriter.write({
      actorUserId: input.actorUserId,
      actionType: 'PRODUCT_UPDATE',
      targetType: 'Product',
      targetId: productId,
      beforeJson,
      afterJson,
      ...(variantInputs !== undefined ? { metadataJson: { scope: VARIANT_SELLABLE_ACTION_LOG_SCOPE } } : {}),
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    return toProductSummary(
      updated,
      undefined,
      undefined,
      await this.getLatestUsdRateToKRW(),
      0,
      afterVariants,
    );
  }

  async updateProductPublicSaleWindow(input: UpdateProductPublicSaleWindowInput): Promise<ProductSummary> {
    const productId = normalizeRequiredString(input.productId, 'productId');
    const current = await this.findProduct(productId);
    const publicSaleWindowStatus = normalizeProductPublicSaleWindowStatus(input.publicSaleWindowStatus);
    const publicSaleStartsAt = input.publicSaleStartsAt === undefined
      ? current.publicSaleStartsAt
      : normalizeOptionalIsoDateTime(input.publicSaleStartsAt, 'publicSaleStartsAt');
    const publicSaleEndsAt = input.publicSaleEndsAt === undefined
      ? current.publicSaleEndsAt
      : normalizeOptionalIsoDateTime(input.publicSaleEndsAt, 'publicSaleEndsAt');
    const reason = input.reason === undefined ? undefined : normalizeOptionalString(input.reason);

    if (publicSaleStartsAt !== null && publicSaleEndsAt !== null && publicSaleEndsAt.getTime() <= publicSaleStartsAt.getTime()) {
      throw new DomainRuleError('VALIDATION_ERROR', 'publicSaleEndsAt must be after publicSaleStartsAt for [start,end) sale windows', 400);
    }

    if ((publicSaleWindowStatus === 'APPROVED' || publicSaleWindowStatus === 'CANCELLED') && reason === undefined) {
      throw new DomainRuleError('VALIDATION_ERROR', 'reason is required when publicSaleWindowStatus is APPROVED or CANCELLED', 400);
    }

    if (publicSaleWindowStatus === 'APPROVED' && publicSaleStartsAt === null) {
      throw new DomainRuleError('VALIDATION_ERROR', 'publicSaleStartsAt is required when publicSaleWindowStatus is APPROVED', 400);
    }

    const now = new Date();
    const changes = {
      publicSaleStartsAt,
      publicSaleEndsAt,
      publicSaleWindowStatus,
      publicSaleWindowUpdatedByUserId: input.actorUserId,
      publicSaleWindowUpdatedAt: now,
    };

    const updated = await this.repository.product.update({
      where: { id: productId },
      data: changes,
    });

    await this.actionLogWriter.write({
      actorUserId: input.actorUserId,
      actionType: 'PRODUCT_UPDATE',
      targetType: 'Product',
      targetId: productId,
      beforeJson: toProductPublicSaleWindowAuditPayload(current),
      afterJson: toProductPublicSaleWindowAuditPayload(updated),
      metadataJson: {
        source: 'manual_oms',
        reason: reason ?? null,
        scope: 'product_public_sale_window',
      },
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    return toProductSummary(updated, undefined, undefined, await this.getLatestUsdRateToKRW());
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
      const updated = await this.repository.$transaction(async (tx) => {
        const updatedProduct = await tx.product.update({
          where: { id: current.id },
          data: productData,
        });
        await this.replaceImwebProductOptions(updatedProduct.id, input.mapped, tx);

        const refreshedMapping = await tx.productExternalMapping.update({
          where: { id: mapping.id },
          data: toImwebMappingRefreshData(input),
        });

        await this.writeImwebImportRow(input, {
          productId: updatedProduct.id,
          mappingId: refreshedMapping.id,
          outcome: 'UPDATED',
        }, tx);

        await new ActionLogWriter(tx.actionLog).write({
          actorUserId: input.actorUserId,
          actionType: 'PRODUCT_UPDATE',
          targetType: 'Product',
          targetId: updatedProduct.id,
          beforeJson: toProductAuditPayload(current),
          afterJson: toProductAuditPayload(updatedProduct),
          metadataJson: { sourceSystem: 'IMWEB_KR', externalProductId, importBatchId: input.importBatchId ?? null },
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
        });

        return updatedProduct;
      });

      return {
        status: 'update',
        product: toProductSummary(updated, undefined, undefined, await this.getLatestUsdRateToKRW()),
      };
    }

    const productId = await this.generateProductId();
    const productData = toImwebProductWriteData(input.mapped);
    const nextSku = productData.sku as string | null;
    if (nextSku !== null) {
      await this.assertSkuAvailable(nextSku);
    }
    const created = await this.repository.$transaction(async (tx) => {
      const createdProduct = await tx.product.create({
        data: {
          id: productId,
          ...productData,
        },
      });
      await this.replaceImwebProductOptions(createdProduct.id, input.mapped, tx);

      const createdMapping = await tx.productExternalMapping.create({
        data: {
          productId: createdProduct.id,
          sourceSystem: 'IMWEB_KR',
          externalProductId,
          ...toImwebMappingRefreshData(input),
          firstImportBatchId: input.importBatchId ?? null,
        },
      });

      await this.writeImwebImportRow(input, {
        productId: createdProduct.id,
        mappingId: createdMapping.id,
        outcome: 'CREATED',
      }, tx);

      await new ActionLogWriter(tx.actionLog).write({
        actorUserId: input.actorUserId,
        actionType: 'PRODUCT_CREATE',
        targetType: 'Product',
        targetId: createdProduct.id,
        afterJson: toProductAuditPayload(createdProduct),
        metadataJson: { sourceSystem: 'IMWEB_KR', externalProductId, importBatchId: input.importBatchId ?? null },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      });

      return createdProduct;
    });

    return {
      status: 'create',
      product: toProductSummary(created, undefined, undefined, await this.getLatestUsdRateToKRW()),
    };
  }

  private async replaceImwebProductOptions(
    productId: string,
    mapped: ImwebMappedProduct,
    repository: ProductRepository = this.repository,
  ): Promise<void> {
    const optionName = normalizeOptionalString(mapped.optionName);
    const optionValues = mapped.optionValues
      .map((value) => normalizeOptionalString(value))
      .filter((value): value is string => value !== undefined);

    await repository.productOptionValue.deleteMany({ where: { option: { productId } } });
    await repository.productOption.deleteMany({ where: { productId } });
    if (!optionName || optionValues.length === 0) return;

    await repository.productOption.create({
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

  // ── Variants ─────────────────────────────────────────────────────────────────

  private variantRepository(repository: ProductRepository): NonNullable<ProductRepository['productVariant']> {
    if (!repository.productVariant) {
      throw new DomainRuleError(
        'PRODUCT_VARIANT_UNSUPPORTED',
        'product variants are not supported by this repository',
        500,
      );
    }
    return repository.productVariant;
  }

  private async createProductVariants(
    productId: string,
    inputs: readonly NormalizedVariant[],
    repository: ProductRepository,
  ): Promise<StoredProductVariant[]> {
    const variantRepo = this.variantRepository(repository);
    const created: StoredProductVariant[] = [];
    for (let index = 0; index < inputs.length; index += 1) {
      const stored = await variantRepo.create({
        data: { productId, ...toVariantWriteData(inputs[index], index) },
      });
      created.push(stored);
    }
    return sortVariants(created);
  }

  /**
   * Deterministic reconcile of variants for a product by id:
   * create entries without an id, update entries whose id matches an existing
   * variant for the product, and delete existing variants absent from the
   * input. An empty input list deletes all variants for the product.
   */
  private async reconcileProductVariants(
    productId: string,
    inputs: readonly NormalizedVariant[],
    repository: ProductRepository,
  ): Promise<{ before: StoredProductVariant[]; after: StoredProductVariant[] }> {
    const variantRepo = this.variantRepository(repository);
    const existing = await variantRepo.findMany({
      where: { productId },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });
    const before = sortVariants(existing);
    const existingIds = new Set(existing.map((variant) => variant.id));

    const referencedIds = new Set<string>();
    for (const input of inputs) {
      if (input.id === undefined) continue;
      if (referencedIds.has(input.id)) {
        throw new DomainRuleError('VALIDATION_ERROR', 'variants contains a duplicate id', 400);
      }
      referencedIds.add(input.id);
      if (!existingIds.has(input.id)) {
        throw new DomainRuleError(
          'PRODUCT_VARIANT_NOT_FOUND',
          `variant ${input.id} does not belong to this product`,
          404,
        );
      }
    }

    const idsToDelete = existing
      .filter((variant) => !referencedIds.has(variant.id))
      .map((variant) => variant.id);
    if (idsToDelete.length > 0) {
      await variantRepo.deleteMany({ where: { id: { in: idsToDelete }, productId } });
    }

    for (let index = 0; index < inputs.length; index += 1) {
      const input = inputs[index];
      if (input.id === undefined) {
        await variantRepo.create({
          data: { productId, ...toVariantWriteData(input, index) },
        });
      } else {
        await variantRepo.update({
          where: { id: input.id },
          data: toVariantWriteData(input, index),
        });
      }
    }

    const after = await variantRepo.findMany({
      where: { productId },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });
    return { before, after: sortVariants(after) };
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
    repository: ProductRepository = this.repository,
  ): Promise<void> {
    if (!input.importBatchId || !input.importRow) return;

    const warnings = [...(input.importRow.warnings ?? [])];
    const warningCodes = [...new Set(warnings.map((warning) => warning.code))];
    const reviewRequired = warnings.some(
      (warning) => warning.severity === 'REVIEW' || warning.scope === 'KODY_REVIEW_REQUIRED',
    );

    await repository.importRow.create({
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

  /**
   * Read-only aggregate of confirmed, still-open (unfulfilled) order quantity
   * per product, derived from order data rather than the event-sourced
   * orderBasedStock counter. Products with no matching open order rows default
   * to 0.
   */
  private async computeOpenOrderedQuantities(
    productIds: readonly string[],
  ): Promise<Map<string, number>> {
    const totals = new Map<string, number>();
    if (productIds.length === 0) return totals;

    const orderItem = this.repository.orderItem;
    if (!orderItem) return totals;

    const grouped = await orderItem.groupBy({
      by: ['productId'],
      where: {
        productId: { in: [...productIds] },
        order: { status: OPEN_ORDER_STATUS },
        shipmentStatus: { not: FULFILLED_SHIPMENT_STATUS },
      },
      _sum: { quantity: true },
    });

    for (const row of grouped) {
      totals.set(row.productId, row._sum.quantity ?? 0);
    }

    return totals;
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

  /**
   * Latest positive USD->KRW conversion rate, normalized to a scale-4 decimal
   * string. Returns null when no positive USD rate is available so callers can
   * surface `priceUSD: null` on derived responses.
   */
  private async getLatestUsdRateToKRW(): Promise<string | null> {
    const fxRate = this.repository.fxRate;
    if (!fxRate) return null;
    const rate = await fxRate.findFirst({
      where: { currency: 'USD', rateToKRW: { gt: 0 } },
      orderBy: [{ date: 'desc' }],
    });
    if (!rate || rate.rateToKRW == null) return null;
    return decimalToString(rate.rateToKRW, 4);
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
      `category must be one of: ${PRODUCT_CATEGORIES.join(', ')}`,
      400,
    );
  }

  return value as ProductCategory;
}

function normalizeNullableCategoryMinor(value: unknown): ProductCategoryMinor | null {
  return value === null ? null : normalizeCategoryMinor(value);
}

function normalizeCategoryMinor(value: unknown): ProductCategoryMinor {
  if (typeof value !== 'string' || !PRODUCT_CATEGORY_MINORS.includes(value as ProductCategoryMinor)) {
    throw new DomainRuleError(
      'VALIDATION_ERROR',
      `categoryMinor must be one of: ${PRODUCT_CATEGORY_MINORS.join(', ')}`,
      400,
    );
  }
  return value as ProductCategoryMinor;
}

function normalizeNullableItemType(value: unknown): ProductItemType | null {
  return value === null ? null : normalizeItemType(value);
}

function normalizeItemType(value: unknown): ProductItemType {
  if (typeof value !== 'string' || !PRODUCT_ITEM_TYPES.includes(value as ProductItemType)) {
    throw new DomainRuleError(
      'VALIDATION_ERROR',
      `itemType must be one of: ${PRODUCT_ITEM_TYPES.join(', ')}`,
      400,
    );
  }
  return value as ProductItemType;
}

function validateProductTaxonomy(
  category: ProductCategory | null,
  categoryMinor: ProductCategoryMinor | null,
  itemType: ProductItemType | null,
): void {
  if (category === 'ALBUM') {
    if (categoryMinor !== null && !ALBUM_CATEGORY_MINORS.includes(categoryMinor)) {
      throw new DomainRuleError('VALIDATION_ERROR', 'ALBUM categoryMinor must be BOY_GROUP, GIRL_GROUP, SOLO, JAPANESE_ALBUM, or OST', 400);
    }
    if (itemType !== null) {
      throw new DomainRuleError('VALIDATION_ERROR', 'itemType is allowed only for GOODS products', 400);
    }
    return;
  }

  if (category === 'GOODS') {
    if (categoryMinor !== null && categoryMinor !== 'OFFICIAL_GOODS' && categoryMinor !== 'FANDOM_GOODS') {
      throw new DomainRuleError('VALIDATION_ERROR', 'GOODS categoryMinor must be OFFICIAL_GOODS or FANDOM_GOODS', 400);
    }
    if (itemType !== null) {
      if (categoryMinor === null) {
        throw new DomainRuleError('VALIDATION_ERROR', 'itemType requires GOODS categoryMinor', 400);
      }
      const allowed = categoryMinor === 'OFFICIAL_GOODS' ? OFFICIAL_GOODS_ITEM_TYPES : FANDOM_GOODS_ITEM_TYPES;
      if (!allowed.includes(itemType)) {
        throw new DomainRuleError('VALIDATION_ERROR', `itemType is not valid for ${categoryMinor}`, 400);
      }
    }
    return;
  }

  if (categoryMinor !== null || itemType !== null) {
    throw new DomainRuleError('VALIDATION_ERROR', 'categoryMinor and itemType require ALBUM or GOODS category in G4c-1', 400);
  }
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
    categoryMinor: null,
    itemType: null,
    categoryMappingSource: mapped.categoryMappingSource,
    sourceCategoryCodes: mapped.rawCategoryIds,
    categoryReviewStatus: mapped.category === null ? 'NEEDS_REVIEW' : 'MAPPED',
    categoryArtist: mapped.categoryArtist,
    categoryArtistDetail: mapped.categoryArtistDetail,
    categoryType: mapped.categoryType,
    categoryTypeDetail: mapped.categoryTypeDetail,
    categoryArtistCandidates: mapped.categoryArtistCandidates,
    categoryArtistDetailCandidates: mapped.categoryArtistDetailCandidates,
    categoryTypeCandidates: mapped.categoryTypeCandidates,
    categoryTypeDetailCandidates: mapped.categoryTypeDetailCandidates,
    categoryProjectionMeta: mapped.categoryProjectionMeta,
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

function deriveDisplayStatus(
  saleStatus: ProductSaleStatus,
  isDisplayed: boolean,
): ProductDisplayStatus {
  if (isDisplayed === false || saleStatus === 'OFF_SALE') return 'HIDDEN';
  if (saleStatus === 'SOLD_OUT') return 'SOLD_OUT';
  if (saleStatus === 'DRAFT') return 'DRAFT';
  if (saleStatus === 'ON_SALE') return 'ON_SALE';
  return 'DRAFT';
}

function scaledDecimalToBigInt(value: string, scale: number): bigint {
  const [integerPart, fractionalPart = ''] = value.split('.');
  const frac = fractionalPart.padEnd(scale, '0').slice(0, scale);
  return BigInt(`${integerPart}${frac}`);
}

/**
 * Convert a scale-4 KRW decimal string into an integer USD amount using the
 * latest positive USD->KRW rate (also a scale-4 decimal string). Uses BigInt
 * math with round-half-up to avoid JS floating point error. Returns null when
 * no usable rate is supplied.
 */
function deriveUsdPrice(priceKRW: string, usdRateToKRW: string | null): number | null {
  if (usdRateToKRW === null) return null;
  const rate = scaledDecimalToBigInt(usdRateToKRW, 4);
  if (rate <= 0n) return null;
  const price = scaledDecimalToBigInt(priceKRW, 4);
  // round-half-up: floor((price / rate) + 1/2) = floor((2*price + rate) / (2*rate))
  const usd = (2n * price + rate) / (2n * rate);
  return Number(usd);
}

function toProductSummary(
  product: StoredProduct,
  externalMappings?: readonly StoredProductExternalMapping[],
  options?: readonly StoredProductOption[],
  usdRateToKRW: string | null = null,
  openOrderedQuantity = 0,
  variants?: readonly StoredProductVariant[],
): ProductSummary {
  const priceKRW = decimalToString(product.priceKRW, 4);
  return {
    id: product.id,
    artistId: product.artistId,
    category: product.category,
    categoryMinor: product.categoryMinor ?? null,
    itemType: product.itemType ?? null,
    name: product.name,
    labelName: product.labelName,
    thumbnailUrl: product.thumbnailUrl,
    detailHtml: product.detailHtml,
    ...(externalMappings !== undefined ? { externalMappings: externalMappings.map(toExternalMappingSummary) } : {}),
    ...(options !== undefined ? { options: options.map(toProductOptionSummary) } : {}),
    ...(variants !== undefined ? { variants: variants.map((variant) => toProductVariantSummary(variant, product)) } : {}),
    releaseDateText: product.releaseDateText,
    releaseDate: product.releaseDate,
    weightG: product.weightG,
    priceKRW,
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
    openOrderedQuantity,
    saleStatus: product.saleStatus,
    isDisplayed: product.isDisplayed,
    displayStatus: deriveDisplayStatus(product.saleStatus, product.isDisplayed),
    priceUSD: deriveUsdPrice(priceKRW, usdRateToKRW),
    categoryMappingSource: product.categoryMappingSource,
    sourceCategoryCodes: [...product.sourceCategoryCodes],
    categoryReviewStatus: product.categoryReviewStatus,
    categoryArtist: product.categoryArtist ?? null,
    categoryArtistDetail: product.categoryArtistDetail ?? null,
    categoryType: product.categoryType ?? null,
    categoryTypeDetail: product.categoryTypeDetail ?? null,
    categoryArtistCandidates: [...(product.categoryArtistCandidates ?? [])],
    categoryArtistDetailCandidates: [...(product.categoryArtistDetailCandidates ?? [])],
    categoryTypeCandidates: [...(product.categoryTypeCandidates ?? [])],
    categoryTypeDetailCandidates: [...(product.categoryTypeDetailCandidates ?? [])],
    categoryProjectionMeta: product.categoryProjectionMeta ?? null,
    publicSaleStartsAt: product.publicSaleStartsAt,
    publicSaleEndsAt: product.publicSaleEndsAt,
    publicSaleWindowStatus: product.publicSaleWindowStatus,
    publicSaleWindowUpdatedByUserId: product.publicSaleWindowUpdatedByUserId,
    publicSaleWindowUpdatedAt: product.publicSaleWindowUpdatedAt,
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

function toProductVariantSummary(variant: StoredProductVariant, product: StoredProduct): ProductVariantSummary {
  const identity = resolveEffectiveVariantIdentity({
    variantSku: variant.sku,
    variantBarcode: variant.barcode,
    productSku: product.sku,
    productBarcode: product.barcode,
  });
  const variantPriceKRW = decimalToString(variant.priceKRW, 4);
  const price = resolveVariantPriceAuthority({
    variantPriceKRW,
    productPriceKRW: decimalToString(product.priceKRW, 4),
  });
  // Product-level public sale windows intentionally are not used here. G5-C-1
  // keeps variant sellable windows separate from `product_public_sale_window`; in
  // the current schema there is no distinct product-level variant-sale window, so
  // the product bound for this contract is open-ended.
  const saleWindow = resolveReadableVariantSaleWindow(variant);

  return {
    id: variant.id,
    productId: variant.productId,
    name: variant.name,
    optionValueIds: [...variant.optionValueIds],
    sku: variant.sku,
    barcode: variant.barcode,
    effectiveSku: identity.effectiveSku,
    effectiveBarcode: identity.effectiveBarcode,
    skuInherited: identity.skuInherited,
    barcodeInherited: identity.barcodeInherited,
    priceKRW: variantPriceKRW,
    effectivePriceKRW: price.priceKRW,
    priceAuthority: price.authority,
    saleStartAt: variant.saleStartAt,
    saleEndAt: variant.saleEndAt,
    effectiveSaleStartAt: saleWindow.startAt,
    effectiveSaleEndAt: saleWindow.endAt,
    saleWindowInheritedFromProduct: saleWindow.inheritedFromProduct,
    saleWindowEmpty: saleWindow.isEmpty,
    position: variant.position,
    createdAt: variant.createdAt,
    updatedAt: variant.updatedAt,
  };
}

function resolveReadableVariantSaleWindow(variant: StoredProductVariant) {
  try {
    return resolveEffectiveVariantSaleWindow({
      product: { startAt: null, endAt: null },
      variant: { startAt: variant.saleStartAt, endAt: variant.saleEndAt },
    });
  } catch (error) {
    if (error instanceof InvalidSaleWindowError && error.side === 'variant') {
      return {
        startAt: null,
        endAt: null,
        inheritedFromProduct: false,
        isEmpty: true,
      };
    }
    throw error;
  }
}

function toVariantAuditPayload(variant: StoredProductVariant, product: StoredProduct): Record<string, unknown> {
  const summary = toProductVariantSummary(variant, product);
  return {
    id: summary.id,
    name: summary.name,
    optionValueIds: summary.optionValueIds,
    sku: summary.sku,
    barcode: summary.barcode,
    effectiveSku: summary.effectiveSku,
    effectiveBarcode: summary.effectiveBarcode,
    skuInherited: summary.skuInherited,
    barcodeInherited: summary.barcodeInherited,
    priceKRW: summary.priceKRW,
    effectivePriceKRW: summary.effectivePriceKRW,
    priceAuthority: summary.priceAuthority,
    saleStartAt: summary.saleStartAt,
    saleEndAt: summary.saleEndAt,
    effectiveSaleStartAt: summary.effectiveSaleStartAt,
    effectiveSaleEndAt: summary.effectiveSaleEndAt,
    saleWindowInheritedFromProduct: summary.saleWindowInheritedFromProduct,
    saleWindowEmpty: summary.saleWindowEmpty,
    position: summary.position,
  };
}

function assertVariantSkuUniqueness(variants: readonly NormalizedVariant[]): void {
  try {
    assertUniqueNonNullVariantSkusPerProduct(variants.map((variant, index) => ({
      variantId: variant.id ?? `index:${index}`,
      sku: variant.sku,
    })));
  } catch (error) {
    if (error instanceof Error && error.name === 'DuplicateVariantSkuError') {
      throw new DomainRuleError(
        'VALIDATION_ERROR',
        'variants must not contain duplicate non-null SKU values within the same product',
        400,
      );
    }
    throw error;
  }
}

function toVariantWriteData(variant: NormalizedVariant, index: number): Record<string, unknown> {
  return {
    name: variant.name,
    optionValueIds: variant.optionValueIds,
    sku: variant.sku,
    barcode: variant.barcode,
    priceKRW: variant.priceKRW,
    saleStartAt: variant.saleStartAt,
    saleEndAt: variant.saleEndAt,
    position: variant.position ?? index,
  };
}

/** Order variants by position asc, then id asc, regardless of repository order. */
function sortVariants(variants: readonly StoredProductVariant[]): StoredProductVariant[] {
  return [...variants].sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

const VARIANT_STOCK_LIKE_FIELDS: readonly string[] = [
  'stockOnHand',
  'stockManaged',
  'stockSnapshot',
  'orderBasedStock',
  'shipmentBasedStock',
  'openOrderedQuantity',
  'quantity',
  'stock',
];

const ISO_DATETIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function normalizeVariantWriteInputs(value: unknown): NormalizedVariant[] {
  if (!Array.isArray(value)) {
    throw new DomainRuleError('VALIDATION_ERROR', 'variants must be an array', 400);
  }
  return value.map((entry, index) => normalizeVariantWriteInput(entry, index));
}

function normalizeVariantWriteInput(entry: unknown, index: number): NormalizedVariant {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    throw new DomainRuleError('VALIDATION_ERROR', `variants[${index}] must be an object`, 400);
  }
  const record = entry as Record<string, unknown>;

  for (const field of VARIANT_STOCK_LIKE_FIELDS) {
    if (record[field] !== undefined) {
      throw new DomainRuleError(
        'VALIDATION_ERROR',
        `variants[${index}].${field} is not allowed; variants do not carry stock`,
        400,
      );
    }
  }

  const id = record.id === undefined ? undefined : normalizeRequiredString(record.id, `variants[${index}].id`);
  const name = normalizeRequiredString(record.name, `variants[${index}].name`);
  const priceKRW = normalizeNonNegativeDecimal(record.priceKRW, `variants[${index}].priceKRW`, 4);
  const sku =
    record.sku === undefined || record.sku === null
      ? null
      : normalizeOptionalString(record.sku) ?? null;
  const barcode =
    record.barcode === undefined || record.barcode === null
      ? null
      : normalizeOptionalString(record.barcode) ?? null;
  const optionValueIds =
    record.optionValueIds === undefined
      ? []
      : normalizeStringArray(record.optionValueIds, `variants[${index}].optionValueIds`);
  const saleStartAt = normalizeOptionalIsoDateTime(record.saleStartAt, `variants[${index}].saleStartAt`);
  const saleEndAt = normalizeOptionalIsoDateTime(record.saleEndAt, `variants[${index}].saleEndAt`);
  if (saleStartAt !== null && saleEndAt !== null && saleStartAt.getTime() >= saleEndAt.getTime()) {
    throw new DomainRuleError(
      'VALIDATION_ERROR',
      `variants[${index}].saleStartAt must be before saleEndAt`,
      400,
    );
  }
  const position =
    record.position === undefined
      ? undefined
      : normalizeNonNegativeInteger(record.position, `variants[${index}].position`);

  return {
    ...(id !== undefined ? { id } : {}),
    name,
    optionValueIds,
    sku,
    barcode,
    priceKRW,
    saleStartAt,
    saleEndAt,
    ...(position !== undefined ? { position } : {}),
  };
}

function normalizeProductPublicSaleWindowStatus(value: unknown): ProductPublicSaleWindowStatus {
  if (typeof value !== 'string' || !(['DRAFT', 'APPROVED', 'CANCELLED'] as const).includes(value as ProductPublicSaleWindowStatus)) {
    throw new DomainRuleError('VALIDATION_ERROR', 'publicSaleWindowStatus must be DRAFT, APPROVED, or CANCELLED', 400);
  }
  return value as ProductPublicSaleWindowStatus;
}

function normalizeOptionalIsoDateTime(value: unknown, field: string): Date | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new DomainRuleError('VALIDATION_ERROR', `${field} must be an ISO date string`, 400);
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }
  if (!ISO_DATETIME_PATTERN.test(trimmed)) {
    throw new DomainRuleError('VALIDATION_ERROR', `${field} must be an ISO date string`, 400);
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new DomainRuleError('VALIDATION_ERROR', `${field} must be a valid ISO date`, 400);
  }
  return parsed;
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
    categoryMinor: product.categoryMinor ?? null,
    itemType: product.itemType ?? null,
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
    categoryArtist: product.categoryArtist ?? null,
    categoryArtistDetail: product.categoryArtistDetail ?? null,
    categoryType: product.categoryType ?? null,
    categoryTypeDetail: product.categoryTypeDetail ?? null,
    categoryArtistCandidates: [...(product.categoryArtistCandidates ?? [])],
    categoryArtistDetailCandidates: [...(product.categoryArtistDetailCandidates ?? [])],
    categoryTypeCandidates: [...(product.categoryTypeCandidates ?? [])],
    categoryTypeDetailCandidates: [...(product.categoryTypeDetailCandidates ?? [])],
    categoryProjectionMeta: product.categoryProjectionMeta ?? null,
  };
}

function toProductPublicSaleWindowAuditPayload(product: StoredProduct): Record<string, unknown> {
  return {
    publicSaleStartsAt: product.publicSaleStartsAt,
    publicSaleEndsAt: product.publicSaleEndsAt,
    publicSaleWindowStatus: product.publicSaleWindowStatus,
    publicSaleWindowUpdatedByUserId: product.publicSaleWindowUpdatedByUserId,
    publicSaleWindowUpdatedAt: product.publicSaleWindowUpdatedAt,
  };
}
