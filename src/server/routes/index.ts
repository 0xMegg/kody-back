import type { FastifyInstance } from 'fastify';
import { registerHealthRoutes } from './health.js';

export function registerRoutes(server: FastifyInstance): void {
  registerHealthRoutes(server);
}
