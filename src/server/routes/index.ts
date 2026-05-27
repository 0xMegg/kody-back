import type { FastifyInstance } from 'fastify';
import { registerAccountRoutes } from './accounts.js';
import { registerAdminUserRoutes } from './admin-users.js';
import { registerArtistRoutes } from './artists.js';
import { registerAuthRoutes } from './auth.js';
import { registerHealthRoutes } from './health.js';
import { registerInviteRoutes } from './invites.js';
import { registerLogsRoutes } from './logs.js';
import { registerPasswordResetRoutes } from './password-reset.js';
import { registerProductRoutes } from './products.js';
import { registerProfileRoutes } from './profile.js';

export function registerRoutes(server: FastifyInstance): void {
  registerAccountRoutes(server);
  registerAdminUserRoutes(server);
  registerArtistRoutes(server);
  registerAuthRoutes(server);
  registerInviteRoutes(server);
  registerLogsRoutes(server);
  registerPasswordResetRoutes(server);
  registerProductRoutes(server);
  registerProfileRoutes(server);
  registerHealthRoutes(server);
}
