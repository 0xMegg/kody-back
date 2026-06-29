import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { Readable } from 'node:stream';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { DomainRuleError } from '@/domain/shared/errors.js';

const ALLOWED_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const EXTENSION_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export interface ProductDetailImageUploadInput {
  fileName: string;
  contentType: string;
  contentBase64: string;
  draftId?: string;
  productId?: string;
}

export interface ProductDetailImageUploadResult {
  url: string;
  key: string;
  contentType: string;
  sizeBytes: number;
  storage: 's3' | 'local';
}

export interface ProductDetailImageReadResult {
  body: Readable;
  contentType: string;
}

export interface ProductAssetServiceConfig {
  uploadDir: string;
  s3Bucket?: string;
  s3Region?: string;
  s3PublicBaseUrl?: string;
  localPublicBaseUrl?: string;
}

export class ProductAssetService {
  private readonly s3Client?: S3Client;

  constructor(private readonly config: ProductAssetServiceConfig) {
    if (config.s3Bucket && config.s3Region) {
      this.s3Client = new S3Client({ region: config.s3Region });
    }
  }

  async uploadProductDetailImage(input: ProductDetailImageUploadInput): Promise<ProductDetailImageUploadResult> {
    const contentType = normalizeContentType(input.contentType);
    const buffer = decodeBase64(input.contentBase64);
    if (buffer.length === 0) {
      throw new DomainRuleError('VALIDATION_ERROR', 'image content is required', 400);
    }
    if (buffer.length > MAX_IMAGE_BYTES) {
      throw new DomainRuleError('PAYLOAD_TOO_LARGE', 'image must be 10MB or smaller', 413);
    }

    const scope = normalizeScope(input.productId, input.draftId);
    const extension = extensionFor(input.fileName, contentType);
    const key = `product-detail/${scope}/${randomUUID()}.${extension}`;

    if (this.s3Client && this.config.s3Bucket) {
      await this.s3Client.send(new PutObjectCommand({
        Bucket: this.config.s3Bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      }));
      return {
        url: buildS3PublicUrl({
          bucket: this.config.s3Bucket,
          region: this.config.s3Region,
          publicBaseUrl: this.config.s3PublicBaseUrl,
          key,
        }),
        key,
        contentType,
        sizeBytes: buffer.length,
        storage: 's3',
      };
    }

    const filePath = join(this.config.uploadDir, key);
    await mkdir(join(this.config.uploadDir, 'product-detail', scope), { recursive: true });
    await writeFile(filePath, buffer);
    const localBase = (this.config.localPublicBaseUrl ?? '').replace(/\/$/, '');
    return {
      url: `${localBase}/uploads/product-detail-images/local/${encodeURIComponent(key)}`,
      key,
      contentType,
      sizeBytes: buffer.length,
      storage: 'local',
    };
  }

  async readLocalProductDetailImage(key: string): Promise<{ buffer: Buffer; contentType: string }> {
    assertValidProductDetailImageKey(key);
    const buffer = await readFile(join(this.config.uploadDir, key));
    return { buffer, contentType: contentTypeForKey(key) };
  }

  async readS3ProductDetailImage(key: string): Promise<ProductDetailImageReadResult> {
    assertValidProductDetailImageKey(key);
    if (!this.s3Client || !this.config.s3Bucket) {
      throw new DomainRuleError('NOT_FOUND', 'image not found', 404);
    }

    try {
      const result = await this.s3Client.send(new GetObjectCommand({
        Bucket: this.config.s3Bucket,
        Key: key,
      }));
      const contentType = normalizeStoredContentType(result.ContentType, key);
      if (!isReadable(result.Body)) {
        throw new DomainRuleError('UPSTREAM_INVALID_RESPONSE', 'image storage returned an invalid response', 502);
      }
      return { body: result.Body, contentType };
    } catch (cause) {
      if (cause instanceof DomainRuleError) {
        throw cause;
      }
      const error = cause as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 403 || error.$metadata?.httpStatusCode === 404) {
        throw new DomainRuleError('NOT_FOUND', 'image not found', 404);
      }
      throw new DomainRuleError('UPSTREAM_UNAVAILABLE', 'image storage is unavailable', 502);
    }
  }
}

function assertValidProductDetailImageKey(key: string): void {
  if ((!key.startsWith('product-detail/') && !key.startsWith('products/')) || key.includes('..')) {
    throw new DomainRuleError('VALIDATION_ERROR', 'invalid image key', 400);
  }
}

function isReadable(value: unknown): value is Readable {
  return value instanceof Readable || (typeof value === 'object' && value !== null && typeof (value as { pipe?: unknown }).pipe === 'function');
}

function normalizeContentType(value: unknown): string {
  if (typeof value !== 'string' || !ALLOWED_CONTENT_TYPES.has(value)) {
    throw new DomainRuleError('VALIDATION_ERROR', 'contentType must be image/jpeg, image/png, image/webp, or image/gif', 400);
  }
  return value;
}

function decodeBase64(value: unknown): Buffer {
  if (typeof value !== 'string') {
    throw new DomainRuleError('VALIDATION_ERROR', 'contentBase64 must be a string', 400);
  }
  const normalized = value.includes(',') ? value.slice(value.indexOf(',') + 1) : value;
  return Buffer.from(normalized, 'base64');
}

function normalizeScope(productId?: string, draftId?: string): string {
  const raw = productId?.trim() || `drafts/${draftId?.trim() || randomUUID()}`;
  if (!/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)?$/.test(raw)) {
    throw new DomainRuleError('VALIDATION_ERROR', 'productId or draftId contains invalid characters', 400);
  }
  return raw;
}

function extensionFor(fileName: string, contentType: string): string {
  const fromType = EXTENSION_BY_TYPE[contentType];
  const fromName = extname(fileName).replace(/^\./, '').toLowerCase();
  if (fromName && ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(fromName)) {
    return fromName === 'jpeg' ? 'jpg' : fromName;
  }
  return fromType;
}

function contentTypeForKey(key: string): string {
  const ext = extname(key).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'application/octet-stream';
}

function normalizeStoredContentType(value: string | undefined, key: string): string {
  if (value && ALLOWED_CONTENT_TYPES.has(value)) {
    return value;
  }
  return contentTypeForKey(key);
}

function buildS3PublicUrl(input: { bucket: string; region?: string; publicBaseUrl?: string; key: string }): string {
  if (input.publicBaseUrl) {
    return `${input.publicBaseUrl.replace(/\/$/, '')}/${encodeURIComponent(input.key)}`;
  }
  return `https://${input.bucket}.s3.${input.region}.amazonaws.com/${input.key}`;
}
