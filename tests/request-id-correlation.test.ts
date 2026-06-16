import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestServer } from './helpers.js';
import { ActionLogWriter } from '@/application/shared/action-log-writer.js';
import { getRequestContext } from '@/server/request-context.js';

describe('request-id correlation', () => {
  let server: FastifyInstance;

  afterEach(async () => {
    await server.close();
  });

  it('retains a safe caller-supplied request-id header on the buildServer path', async () => {
    server = buildTestServer();
    server.get('/request-id-echo', async (request) => ({ requestId: request.id }));
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/request-id-echo',
      headers: { 'request-id': 'caller-req_123:abc.def' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ requestId: 'caller-req_123:abc.def' });
  });

  it('generates a safe fallback request id when the caller omits request-id', async () => {
    server = buildTestServer();
    server.get('/request-id-echo', async (request) => ({ requestId: request.id }));
    await server.ready();

    const response = await server.inject({ method: 'GET', url: '/request-id-echo' });
    const { requestId } = response.json() as { requestId: string };

    expect(response.statusCode).toBe(200);
    expect(requestId).toMatch(/^[A-Za-z0-9._:-]{1,128}$/);
  });

  it('rejects unsafe caller request-id values and generates a fallback', async () => {
    server = buildTestServer();
    server.get('/request-id-echo', async (request) => ({ requestId: request.id }));
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/request-id-echo',
      headers: { 'request-id': 'unsafe id with spaces and bearer secret' },
    });
    const { requestId } = response.json() as { requestId: string };

    expect(response.statusCode).toBe(200);
    expect(requestId).not.toBe('unsafe id with spaces and bearer secret');
    expect(requestId).toMatch(/^[A-Za-z0-9._:-]{1,128}$/);
  });

  it('adds safe request correlation to not-found response bodies', async () => {
    server = buildTestServer();
    await server.ready();

    const response = await server.inject({
      method: 'GET',
      url: '/missing-route',
      headers: { 'request-id': 'not-found-req-1' },
    });
    const body = response.json();

    expect(response.statusCode).toBe(404);
    expect(body).toMatchObject({
      ok: false,
      requestId: 'not-found-req-1',
      error: { code: 'NOT_FOUND', message: 'Route not found' },
    });
  });

  it('adds safe request correlation to central error logs and response bodies without payload data', async () => {
    server = buildTestServer();
    const errorLog = vi.spyOn(server.log, 'error').mockImplementation(() => undefined);
    server.post('/request-error/:id', async () => {
      throw new Error('boom');
    });
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/request-error/order-123?token=secret-token',
      headers: {
        'request-id': 'caller-error-req-1',
        authorization: 'Bearer do-not-log',
      },
      payload: { password: 'do-not-log' },
    });
    const body = response.json();

    expect(response.statusCode).toBe(500);
    expect(body.requestId).toBe('caller-error-req-1');
    expect(body.error.code).toBe('INTERNAL_ERROR');

    expect(errorLog).toHaveBeenCalledTimes(1);
    const [logPayload] = errorLog.mock.calls[0] as [Record<string, unknown>];
    expect(logPayload).toMatchObject({
      requestId: 'caller-error-req-1',
      method: 'POST',
      url: '/request-error/order-123',
      route: '/request-error/:id',
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
    expect(JSON.stringify(logPayload)).not.toContain('do-not-log');
    expect(JSON.stringify(logPayload)).not.toContain('secret-token');
    expect(JSON.stringify(logPayload)).not.toContain('password');
    expect(JSON.stringify(logPayload)).not.toContain('Bearer');
  });

  it('exposes request context to business ActionLog writes without route contract expansion', async () => {
    server = buildTestServer();
    const create = vi.fn(async () => ({}));
    const writer = new ActionLogWriter({ create });
    server.post('/business-write', async () => {
      expect(getRequestContext()).toEqual({ requestId: 'biz-req-1' });
      await writer.write({
        actorUserId: 'user_1',
        actionType: 'ORDER_CREATE',
        targetType: 'Order',
        targetId: 'order_1',
        metadataJson: { operation: 'create' },
      });
      return { ok: true };
    });
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/business-write',
      headers: { 'request-id': 'biz-req-1' },
    });

    expect(response.statusCode).toBe(200);
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadataJson: { operation: 'create', requestId: 'biz-req-1' },
      }),
    });
  });
});
