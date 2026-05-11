import type { PrismaClient } from '@prisma/client';
import { AdminUserService } from '@/application/admin/admin-user-service.js';
import { AuthService } from '@/application/auth/auth-service.js';
import { ActionLogWriter } from '@/application/shared/action-log-writer.js';
import type { ServerConfig } from './config.js';

export interface ServerServices {
  adminUsers: AdminUserService;
  auth: AuthService;
}

export function buildServerServices(
  prisma: PrismaClient,
  config: Pick<ServerConfig, 'authJwtSecret'>,
): ServerServices {
  const actionLogWriter = new ActionLogWriter(prisma.actionLog as never);

  return {
    adminUsers: new AdminUserService(prisma as never, actionLogWriter),
    auth: new AuthService(prisma as never, actionLogWriter, {
      jwtSecret: config.authJwtSecret,
    }),
  };
}
