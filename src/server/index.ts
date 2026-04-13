import { PrismaClient } from '@prisma/client';
import { loadConfig } from './config.js';
import { buildServerServices } from './services.js';
import { buildServer } from './server.js';

async function main() {
  const config = loadConfig();
  const prisma = new PrismaClient();
  const services = buildServerServices(prisma);
  const server = buildServer(config, prisma, services);

  const shutdown = async () => {
    server.log.info('Shutting down...');
    await server.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await server.listen({ port: config.port, host: config.host });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
