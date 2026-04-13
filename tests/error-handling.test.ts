import { describe, it, expect, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestServer } from './helpers.js';
import { DomainRuleError } from '@/domain/shared/errors.js';
import {
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
} from '@/server/api/errors.js';

describe('Error handling', () => {
  let server: FastifyInstance;

  afterEach(async () => {
    await server.close();
  });

  it('should return 404 for unknown routes', async () => {
    server = buildTestServer();
    await server.ready();

    const response = await server.inject({ method: 'GET', url: '/nonexistent' });
    const body = response.json();

    expect(response.statusCode).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('should convert DomainRuleError to proper API error', async () => {
    server = buildTestServer();
    server.get('/test-domain-error', async () => {
      throw new DomainRuleError('ORDER_ALREADY_SHIPPED', 'Order has already been shipped', 422);
    });
    await server.ready();

    const response = await server.inject({ method: 'GET', url: '/test-domain-error' });
    const body = response.json();

    expect(response.statusCode).toBe(422);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('ORDER_ALREADY_SHIPPED');
    expect(body.error.message).toBe('Order has already been shipped');
  });

  it('should convert unknown errors to 500 INTERNAL_ERROR', async () => {
    server = buildTestServer();
    server.get('/test-unknown-error', async () => {
      throw new Error('Something went wrong');
    });
    await server.ready();

    const response = await server.inject({ method: 'GET', url: '/test-unknown-error' });
    const body = response.json();

    expect(response.statusCode).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('An unexpected error occurred');
  });

  it('should convert ValidationError correctly', async () => {
    server = buildTestServer();
    server.get('/test-validation-error', async () => {
      throw new ValidationError('Invalid email format');
    });
    await server.ready();

    const response = await server.inject({ method: 'GET', url: '/test-validation-error' });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('Invalid email format');
  });

  it('should convert AuthenticationError correctly', async () => {
    server = buildTestServer();
    server.get('/test-auth-error', async () => {
      throw new AuthenticationError();
    });
    await server.ready();

    const response = await server.inject({ method: 'GET', url: '/test-auth-error' });
    const body = response.json();

    expect(response.statusCode).toBe(401);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('AUTHENTICATION_ERROR');
  });

  it('should convert AuthorizationError correctly', async () => {
    server = buildTestServer();
    server.get('/test-authz-error', async () => {
      throw new AuthorizationError();
    });
    await server.ready();

    const response = await server.inject({ method: 'GET', url: '/test-authz-error' });
    const body = response.json();

    expect(response.statusCode).toBe(403);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('AUTHORIZATION_ERROR');
  });

  it('should convert NotFoundError correctly', async () => {
    server = buildTestServer();
    server.get('/test-not-found-error', async () => {
      throw new NotFoundError('Product not found');
    });
    await server.ready();

    const response = await server.inject({ method: 'GET', url: '/test-not-found-error' });
    const body = response.json();

    expect(response.statusCode).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toBe('Product not found');
  });

  it('should convert ConflictError correctly', async () => {
    server = buildTestServer();
    server.get('/test-conflict-error', async () => {
      throw new ConflictError('Duplicate order ID');
    });
    await server.ready();

    const response = await server.inject({ method: 'GET', url: '/test-conflict-error' });
    const body = response.json();

    expect(response.statusCode).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('CONFLICT');
    expect(body.error.message).toBe('Duplicate order ID');
  });
});
