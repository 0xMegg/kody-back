import type { PrismaClient } from '@prisma/client';
import { AccountService } from '@/application/account/account-service.js';
import { AdminUserService } from '@/application/admin/admin-user-service.js';
import { AuthService } from '@/application/auth/auth-service.js';
import { InviteService } from '@/application/auth/invite-service.js';
import { PasswordResetService } from '@/application/auth/password-reset-service.js';
import { ActionLogQueryService } from '@/application/logs/action-log-query-service.js';
import { ActionLogWriter } from '@/application/shared/action-log-writer.js';
import type { ServerConfig } from './config.js';

export interface ServerServices {
  accounts: AccountService;
  adminUsers: AdminUserService;
  auth: AuthService;
  invites: InviteService;
  logs: ActionLogQueryService;
  passwordReset: PasswordResetService;
}

export function buildServerServices(
  prisma: PrismaClient,
  config: Pick<ServerConfig, 'authJwtSecret'>,
): ServerServices {
  const actionLogWriter = new ActionLogWriter(prisma.actionLog as never);

  return {
    accounts: new AccountService(prisma as never, actionLogWriter),
    adminUsers: new AdminUserService(prisma as never, actionLogWriter),
    auth: new AuthService(prisma as never, actionLogWriter, {
      jwtSecret: config.authJwtSecret,
    }),
    invites: new InviteService(prisma as never),
    logs: new ActionLogQueryService(prisma as never),
    passwordReset: new PasswordResetService(prisma as never),
  };
}
