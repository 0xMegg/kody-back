import 'dotenv/config';

export interface ServerConfig {
  port: number;
  host: string;
  corsOrigin: string;
  databaseUrl: string;
  authJwtSecret: string;
  appOrigin: string;
  smtpHost?: string;
  smtpPort: number;
  smtpUser?: string;
  smtpPassword?: string;
  smtpSecure: boolean;
  smtpRequireTls: boolean;
  emailFrom: string;
  productAssetUploadDir: string;
  productAssetLocalPublicBaseUrl: string;
  productAssetS3Bucket?: string;
  productAssetS3Region?: string;
  productAssetS3PublicBaseUrl?: string;
}

export function loadConfig(): ServerConfig {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  const authJwtSecret = process.env.AUTH_JWT_SECRET;
  if (!authJwtSecret) {
    throw new Error('AUTH_JWT_SECRET environment variable is required');
  }

  return {
    port: Number(process.env.PORT) || 4000,
    host: process.env.HOST || '0.0.0.0',
    corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    databaseUrl,
    authJwtSecret,
    appOrigin: process.env.APP_ORIGIN || process.env.CORS_ORIGIN || 'http://localhost:3000',
    smtpHost: process.env.SMTP_HOST,
    smtpPort: Number(process.env.SMTP_PORT) || 1025,
    smtpUser: process.env.SMTP_USER,
    smtpPassword: process.env.SMTP_PASSWORD,
    smtpSecure: parseBoolean(process.env.SMTP_SECURE, false),
    smtpRequireTls: parseBoolean(process.env.SMTP_REQUIRE_TLS, false),
    emailFrom: process.env.EMAIL_FROM || 'no-reply@kody.test',
    productAssetUploadDir: process.env.PRODUCT_ASSET_UPLOAD_DIR || '.uploads',
    productAssetLocalPublicBaseUrl:
      process.env.PRODUCT_ASSET_LOCAL_PUBLIC_BASE_URL ||
      process.env.BACKEND_PUBLIC_ORIGIN ||
      `http://localhost:${Number(process.env.PORT) || 4000}`,
    productAssetS3Bucket: process.env.PRODUCT_ASSET_S3_BUCKET,
    productAssetS3Region: process.env.PRODUCT_ASSET_S3_REGION || process.env.AWS_REGION,
    productAssetS3PublicBaseUrl: process.env.PRODUCT_ASSET_S3_PUBLIC_BASE_URL,
  };
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === 'true' || value === '1' || value.toLowerCase() === 'yes';
}
