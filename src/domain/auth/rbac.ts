import type { Role } from '@/domain/shared/types.js';

export type PermissionResource =
  | 'userAdmin'
  | 'profile'
  | 'account'
  | 'productInventory'
  | 'product'
  | 'payment'
  | 'order'
  | 'shipment'
  | 'logs';

export type PermissionAction = 'read' | 'write' | 'execute';

export interface Permission {
  resource: PermissionResource;
  action: PermissionAction;
}

type PermissionSet = Partial<Record<PermissionResource, readonly PermissionAction[]>>;

const FULL_ACCESS_ROLES = new Set<Role>(['ADMIN', 'FINANCE']);

const ROLE_PERMISSIONS: Record<Exclude<Role, 'ADMIN' | 'FINANCE'>, PermissionSet> = {
  SALES: {
    profile: ['read', 'write'],
    account: ['read', 'write'],
    productInventory: ['read'],
    product: ['read'],
    payment: ['read'],
    order: ['read', 'write'],
    shipment: ['read'],
    logs: ['read'],
  },
  OPERATIONS: {
    profile: ['read', 'write'],
    account: ['read', 'write'],
    productInventory: ['read', 'write'],
    product: ['read', 'write'],
    payment: ['read'],
    order: ['read', 'write'],
    shipment: ['read'],
    logs: ['read'],
  },
  WAREHOUSE: {
    profile: ['read', 'write'],
    account: ['read'],
    productInventory: ['read', 'write'],
    product: ['read', 'write'],
    payment: ['read'],
    order: ['read'],
    shipment: ['read', 'write', 'execute'],
    logs: ['read'],
  },
};

export function hasPermission(roles: readonly Role[], permission: Permission): boolean {
  if (roles.some((role) => FULL_ACCESS_ROLES.has(role))) {
    return true;
  }

  return roles.some((role) => {
    if (role === 'ADMIN' || role === 'FINANCE') {
      return true;
    }

    return ROLE_PERMISSIONS[role][permission.resource]?.includes(permission.action) ?? false;
  });
}

export function assertPermission(roles: readonly Role[], permission: Permission): void {
  if (!hasPermission(roles, permission)) {
    throw new Error(`Missing permission: ${permission.resource}.${permission.action}`);
  }
}
