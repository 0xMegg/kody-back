import 'dotenv/config';

export interface ServerConfig {
  port: number;
  host: string;
  corsOrigin: string;
  databaseUrl: string;
  authJwtSecret: string;
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
  };
}
