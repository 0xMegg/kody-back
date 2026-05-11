import type { FastifyInstance } from 'fastify';
import { registerAdminUserRoutes } from './admin-users.js';
import { registerAuthRoutes } from './auth.js';
import { registerHealthRoutes } from './health.js';
import { registerProfileRoutes } from './profile.js';

export function registerRoutes(server: FastifyInstance): void {
  registerAdminUserRoutes(server);
  registerAuthRoutes(server);
  registerProfileRoutes(server);
  registerHealthRoutes(server);
}
