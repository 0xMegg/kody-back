import type { PrismaClient } from '@prisma/client';
import { AccountService } from '@/application/account/account-service.js';
import { ShippingAddressService } from '@/application/account/shipping-address-service.js';
import { AdminEmployeeService } from '@/application/admin/admin-employee-service.js';
import { AdminUserService } from '@/application/admin/admin-user-service.js';
import { AuthService } from '@/application/auth/auth-service.js';
import { InviteService } from '@/application/auth/invite-service.js';
import {
  DevOutboxInviteEmailSender,
  SmtpInviteEmailSender,
} from '@/application/auth/invite-email-sender.js';
import { PasswordResetService } from '@/application/auth/password-reset-service.js';
import { ActionLogQueryService } from '@/application/logs/action-log-query-service.js';
import { ProductService } from '@/application/product/product-service.js';
import { PaymentService } from '@/application/payment/payment-service.js';
import { ActionLogWriter } from '@/application/shared/action-log-writer.js';
import type { ServerConfig } from './config.js';

export interface ServerServices {
  accounts: AccountService;
  shippingAddresses: ShippingAddressService;
  adminEmployees: AdminEmployeeService;
  adminUsers: AdminUserService;
  auth: AuthService;
  invites: InviteService;
  logs: ActionLogQueryService;
  passwordReset: PasswordResetService;
  products: ProductService;
  payments: PaymentService;
}

export function buildServerServices(
  prisma: PrismaClient,
  config: Pick<
    ServerConfig,
    'authJwtSecret' | 'appOrigin' | 'smtpHost' | 'smtpPort' | 'smtpUser' | 'smtpPassword' | 'smtpSecure' | 'smtpRequireTls' | 'emailFrom'
  >,
): ServerServices {
  const actionLogWriter = new ActionLogWriter(prisma.actionLog as never);
  const inviteEmailSender = config.smtpHost
    ? new SmtpInviteEmailSender({
        host: config.smtpHost,
        port: config.smtpPort,
        from: config.emailFrom,
        user: config.smtpUser,
        password: config.smtpPassword,
        secure: config.smtpSecure,
        requireTls: config.smtpRequireTls,
      })
    : new DevOutboxInviteEmailSender();

  return {
    accounts: new AccountService(prisma as never, actionLogWriter),
    shippingAddresses: new ShippingAddressService(prisma as never),
    adminEmployees: new AdminEmployeeService(prisma as never),
    adminUsers: new AdminUserService(prisma as never, actionLogWriter),
    auth: new AuthService(prisma as never, actionLogWriter, {
      jwtSecret: config.authJwtSecret,
    }),
    invites: new InviteService(prisma as never, undefined, inviteEmailSender, config.appOrigin),
    logs: new ActionLogQueryService(prisma as never),
    passwordReset: new PasswordResetService(prisma as never),
    products: new ProductService(prisma as never, actionLogWriter),
    payments: new PaymentService(prisma as never, actionLogWriter),
  };
}
