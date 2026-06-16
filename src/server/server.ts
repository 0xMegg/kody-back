import Fastify from 'fastify';
import cors from '@fastify/cors';
import type { PrismaClient } from '@prisma/client';
import type { ServerConfig } from './config.js';
import type { ServerServices } from './services.js';
import { registerServerHooks } from './hooks.js';
import { registerRoutes } from './routes/index.js';
import { generateRequestId } from './request-id.js';
import { safeRequestUrl } from './safe-request-url.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: ServerConfig;
    prisma: PrismaClient;
    services: ServerServices;
  }
}

export function buildServer(
  config: ServerConfig,
  prisma: PrismaClient,
  services: ServerServices,
) {
  const server = Fastify({
    logger: {
      serializers: {
        req(request) {
          return {
            method: request.method,
            url: safeRequestUrl(request.url),
            host: request.host,
          };
        },
      },
    },
    genReqId: generateRequestId,
  });

  server.register(cors, { origin: config.corsOrigin });

  server.decorate('config', config);
  server.decorate('prisma', prisma);
  server.decorate('services', services);

  registerServerHooks(server);
  registerRoutes(server);

  return server;
}
