import type { FastifyInstance } from 'fastify';
import { registerAdminUserRoutes } from './admin-users.js';
import { registerAuthRoutes } from './auth.js';
import { registerHealthRoutes } from './health.js';
import { registerInviteRoutes } from './invites.js';
import { registerPasswordResetRoutes } from './password-reset.js';
import { registerProfileRoutes } from './profile.js';

export function registerRoutes(server: FastifyInstance): void {
  registerAdminUserRoutes(server);
  registerAuthRoutes(server);
  registerInviteRoutes(server);
  registerPasswordResetRoutes(server);
  registerProfileRoutes(server);
  registerHealthRoutes(server);
}
