import type { PrismaClient } from '@prisma/client';
import type { ServerConfig } from '@/server/config.js';
import type { ServerServices } from '@/server/services.js';
import { buildServer } from '@/server/server.js';

const testConfig: ServerConfig = {
  port: 0,
  host: '127.0.0.1',
  corsOrigin: '*',
  databaseUrl: 'postgresql://test:test@localhost:5432/test',
  authJwtSecret: 'test-secret',
};

const testServices: ServerServices = {};

export function createMockPrisma(overrides: Partial<PrismaClient> = {}) {
  return {
    $queryRaw: async () => [{ '?column?': 1 }],
    ...overrides,
  } as unknown as PrismaClient;
}

export function buildTestServer(prismaOverrides: Partial<PrismaClient> = {}) {
  const prisma = createMockPrisma(prismaOverrides);
  const server = buildServer(testConfig, prisma, testServices);
  return server;
}
