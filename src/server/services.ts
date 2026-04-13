import type { PrismaClient } from '@prisma/client';

export interface ServerServices {
  // Use cases will be added here as domain modules are implemented
}

export function buildServerServices(_prisma: PrismaClient): ServerServices {
  return {};
}
