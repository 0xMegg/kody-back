import { describe, expect, it } from 'vitest';
import { hasPermission } from '@/domain/auth/rbac.js';

describe('RBAC permission matrix', () => {
  it('allows ADMIN and FINANCE full access', () => {
    expect(hasPermission(['ADMIN'], { resource: 'payment', action: 'write' })).toBe(true);
    expect(hasPermission(['FINANCE'], { resource: 'shipment', action: 'execute' })).toBe(true);
    expect(hasPermission(['FINANCE'], { resource: 'userAdmin', action: 'write' })).toBe(true);
  });

  it('applies multiple roles as a union', () => {
    expect(hasPermission(['SALES', 'WAREHOUSE'], { resource: 'order', action: 'write' })).toBe(true);
    expect(hasPermission(['SALES', 'WAREHOUSE'], { resource: 'shipment', action: 'execute' })).toBe(true);
  });

  it('keeps userAdmin write restricted to ADMIN and FINANCE', () => {
    expect(hasPermission(['ADMIN'], { resource: 'userAdmin', action: 'write' })).toBe(true);
    expect(hasPermission(['FINANCE'], { resource: 'userAdmin', action: 'write' })).toBe(true);
    expect(hasPermission(['SALES'], { resource: 'userAdmin', action: 'write' })).toBe(false);
    expect(hasPermission(['OPERATIONS'], { resource: 'userAdmin', action: 'write' })).toBe(false);
    expect(hasPermission(['WAREHOUSE'], { resource: 'userAdmin', action: 'write' })).toBe(false);
  });

  it('keeps payment write restricted to ADMIN and FINANCE', () => {
    expect(hasPermission(['ADMIN'], { resource: 'payment', action: 'write' })).toBe(true);
    expect(hasPermission(['FINANCE'], { resource: 'payment', action: 'write' })).toBe(true);
    expect(hasPermission(['SALES'], { resource: 'payment', action: 'write' })).toBe(false);
    expect(hasPermission(['OPERATIONS'], { resource: 'payment', action: 'write' })).toBe(false);
    expect(hasPermission(['WAREHOUSE'], { resource: 'payment', action: 'write' })).toBe(false);
  });

  it('allows payment read for operational roles', () => {
    expect(hasPermission(['SALES'], { resource: 'payment', action: 'read' })).toBe(true);
    expect(hasPermission(['OPERATIONS'], { resource: 'payment', action: 'read' })).toBe(true);
    expect(hasPermission(['WAREHOUSE'], { resource: 'payment', action: 'read' })).toBe(true);
  });

  it('grants productInventory write to OPERATIONS, WAREHOUSE, and full-access roles; denies SALES', () => {
    expect(hasPermission(['ADMIN'], { resource: 'productInventory', action: 'write' })).toBe(true);
    expect(hasPermission(['FINANCE'], { resource: 'productInventory', action: 'write' })).toBe(true);
    expect(hasPermission(['OPERATIONS'], { resource: 'productInventory', action: 'write' })).toBe(true);
    expect(hasPermission(['WAREHOUSE'], { resource: 'productInventory', action: 'write' })).toBe(true);
    expect(hasPermission(['SALES'], { resource: 'productInventory', action: 'write' })).toBe(false);
  });

  it('grants account write to SALES, OPERATIONS, and full-access roles; denies WAREHOUSE', () => {
    expect(hasPermission(['ADMIN'], { resource: 'account', action: 'write' })).toBe(true);
    expect(hasPermission(['FINANCE'], { resource: 'account', action: 'write' })).toBe(true);
    expect(hasPermission(['SALES'], { resource: 'account', action: 'write' })).toBe(true);
    expect(hasPermission(['OPERATIONS'], { resource: 'account', action: 'write' })).toBe(true);
    expect(hasPermission(['WAREHOUSE'], { resource: 'account', action: 'write' })).toBe(false);
  });

  it('grants order write to SALES, OPERATIONS, and full-access roles; denies WAREHOUSE', () => {
    expect(hasPermission(['ADMIN'], { resource: 'order', action: 'write' })).toBe(true);
    expect(hasPermission(['FINANCE'], { resource: 'order', action: 'write' })).toBe(true);
    expect(hasPermission(['SALES'], { resource: 'order', action: 'write' })).toBe(true);
    expect(hasPermission(['OPERATIONS'], { resource: 'order', action: 'write' })).toBe(true);
    expect(hasPermission(['WAREHOUSE'], { resource: 'order', action: 'write' })).toBe(false);
  });

  it('allows shipment execution to WAREHOUSE plus full-access roles only', () => {
    expect(hasPermission(['WAREHOUSE'], { resource: 'shipment', action: 'execute' })).toBe(true);
    expect(hasPermission(['ADMIN'], { resource: 'shipment', action: 'execute' })).toBe(true);
    expect(hasPermission(['FINANCE'], { resource: 'shipment', action: 'execute' })).toBe(true);
    expect(hasPermission(['OPERATIONS'], { resource: 'shipment', action: 'execute' })).toBe(false);
    expect(hasPermission(['SALES'], { resource: 'shipment', action: 'execute' })).toBe(false);
  });

  it('grants logs read to every role', () => {
    expect(hasPermission(['ADMIN'], { resource: 'logs', action: 'read' })).toBe(true);
    expect(hasPermission(['FINANCE'], { resource: 'logs', action: 'read' })).toBe(true);
    expect(hasPermission(['SALES'], { resource: 'logs', action: 'read' })).toBe(true);
    expect(hasPermission(['OPERATIONS'], { resource: 'logs', action: 'read' })).toBe(true);
    expect(hasPermission(['WAREHOUSE'], { resource: 'logs', action: 'read' })).toBe(true);
  });
});
