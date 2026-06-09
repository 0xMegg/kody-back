import type { FastifyInstance } from 'fastify';
import { registerAccountRoutes } from './accounts.js';
import { registerAdminEmployeeRoutes } from './admin-employees.js';
import { registerAdminUserRoutes } from './admin-users.js';
import { registerArtistRoutes } from './artists.js';
import { registerAuthRoutes } from './auth.js';
import { registerFxRateRoutes } from './fx-rates.js';
import { registerHealthRoutes } from './health.js';
import { registerInviteRoutes } from './invites.js';
import { registerLogsRoutes } from './logs.js';
import { registerOrderRoutes } from './orders.js';
import { registerPasswordResetRoutes } from './password-reset.js';
import { registerPaymentRoutes } from './payments.js';
import { registerProductRoutes } from './products.js';
import { registerProfileRoutes } from './profile.js';

export function registerRoutes(server: FastifyInstance): void {
  registerAccountRoutes(server);
  registerAdminEmployeeRoutes(server);
  registerAdminUserRoutes(server);
  registerArtistRoutes(server);
  registerAuthRoutes(server);
  registerFxRateRoutes(server);
  registerInviteRoutes(server);
  registerLogsRoutes(server);
  registerOrderRoutes(server);
  registerPasswordResetRoutes(server);
  registerPaymentRoutes(server);
  registerProductRoutes(server);
  registerProfileRoutes(server);
  registerHealthRoutes(server);
}
