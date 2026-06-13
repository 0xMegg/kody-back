import type { PrismaClient } from '@prisma/client';
import type { ServerConfig } from '@/server/config.js';
import { buildServerServices } from '@/server/services.js';
import { buildServer } from '@/server/server.js';

const testConfig: ServerConfig = {
  port: 0,
  host: '127.0.0.1',
  corsOrigin: '*',
  databaseUrl: 'postgresql://test:test@localhost:5432/test',
  authJwtSecret: 'test-secret',
  appOrigin: 'http://localhost:3000',
  smtpPort: 1025,
  smtpSecure: false,
  smtpRequireTls: false,
  emailFrom: 'no-reply@kody.test',
  productAssetUploadDir: '/tmp/kody-test-uploads',
  productAssetLocalPublicBaseUrl: 'http://localhost:4000',
};

export function createMockPrisma(overrides: Partial<PrismaClient> = {}) {
  return {
    $queryRaw: async () => [{ '?column?': 1 }],
    ...overrides,
  } as unknown as PrismaClient;
}

export function buildTestServer(prismaOverrides: Partial<PrismaClient> = {}) {
  const prisma = createMockPrisma(prismaOverrides);
  const testServices = buildServerServices(prisma, testConfig);
  const server = buildServer(testConfig, prisma, testServices);
  return server;
}
