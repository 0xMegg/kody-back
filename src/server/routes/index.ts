import type { FastifyInstance } from 'fastify';
import { registerAccountRoutes } from './accounts.js';
import { registerAdminUserRoutes } from './admin-users.js';
import { registerAuthRoutes } from './auth.js';
import { registerHealthRoutes } from './health.js';
import { registerInviteRoutes } from './invites.js';
import { registerLogsRoutes } from './logs.js';
import { registerPasswordResetRoutes } from './password-reset.js';
import { registerProfileRoutes } from './profile.js';

export function registerRoutes(server: FastifyInstance): void {
  registerAccountRoutes(server);
  registerAdminUserRoutes(server);
  registerAuthRoutes(server);
  registerInviteRoutes(server);
  registerLogsRoutes(server);
  registerPasswordResetRoutes(server);
  registerProfileRoutes(server);
  registerHealthRoutes(server);
}
