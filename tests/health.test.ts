import { describe, it, expect, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestServer } from './helpers.js';

describe('GET /health', () => {
  let server: FastifyInstance;

  afterEach(async () => {
    await server.close();
  });

  it('should return healthy status when database is connected', async () => {
    server = buildTestServer();
    await server.ready();

    const response = await server.inject({ method: 'GET', url: '/health' });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.status).toBe('healthy');
    expect(body.data.database).toBe('connected');
    expect(body.data.timestamp).toBeDefined();
  });

  it('should return degraded status when database is disconnected', async () => {
    server = buildTestServer({
      $queryRaw: (async () => {
        throw new Error('Connection refused');
      }) as never,
    });
    await server.ready();

    const response = await server.inject({ method: 'GET', url: '/health' });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.status).toBe('degraded');
    expect(body.data.database).toBe('disconnected');
    expect(body.data.timestamp).toBeDefined();
  });
});
