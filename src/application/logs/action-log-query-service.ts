import type { AuthenticatedUser } from '@/application/auth/auth-service.js';
import { hasPermission, type PermissionResource } from '@/domain/auth/rbac.js';
import type { ActionType } from '@/domain/shared/types.js';
import { AuthorizationError } from '@/server/api/index.js';

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;

const TARGET_TYPE_TO_RESOURCE: Readonly<Record<string, PermissionResource>> = {
  User: 'userAdmin',
  Employee: 'userAdmin',
  InviteToken: 'userAdmin',
  RefreshToken: 'userAdmin',
  PasswordResetToken: 'userAdmin',
  Account: 'account',
  ShippingAddress: 'account',
  AccountRelation: 'account',
  Product: 'productInventory',
  StockMovement: 'productInventory',
  Payment: 'payment',
  FxRate: 'payment',
  Order: 'order',
  OrderItem: 'order',
  Shipment: 'shipment',
  ShipmentItem: 'shipment',
};

export interface LogQueryFilters {
  actorUserId?: string;
  actionType?: ActionType;
  targetType?: string;
  targetId?: string;
}

export interface LogQueryPagination {
  page?: number;
  pageSize?: number;
}

export interface ListLogsInput {
  authUser: AuthenticatedUser;
  filters: LogQueryFilters;
  pagination: LogQueryPagination;
}

export interface ActionLogItem {
  id: string;
  actorUserId: string | null;
  actionType: ActionType;
  targetType: string;
  targetId: string | null;
  beforeJson: unknown;
  afterJson: unknown;
  metadataJson: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}

export interface ListLogsResult {
  items: ActionLogItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

interface StoredActionLog {
  id: string;
  actorUserId: string | null;
  actionType: ActionType;
  targetType: string;
  targetId: string | null;
  beforeJson: unknown;
  afterJson: unknown;
  metadataJson: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}

interface ActionLogQueryRepository {
  actionLog: {
    findMany(args: {
      where: Record<string, unknown>;
      orderBy: { createdAt: 'desc' };
      skip: number;
      take: number;
    }): Promise<StoredActionLog[]>;
    count(args: { where: Record<string, unknown> }): Promise<number>;
  };
}

export class ActionLogQueryService {
  constructor(private readonly repository: ActionLogQueryRepository) {}

  async listLogs(input: ListLogsInput): Promise<ListLogsResult> {
    const page = input.pagination.page ?? DEFAULT_PAGE;
    const pageSize = input.pagination.pageSize ?? DEFAULT_PAGE_SIZE;
    const skip = (page - 1) * pageSize;
    const take = pageSize;

    const where = this.buildWhere(input.authUser, input.filters);

    const [items, total] = await Promise.all([
      this.repository.actionLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.repository.actionLog.count({ where }),
    ]);

    return {
      items,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
      },
    };
  }

  private buildWhere(
    authUser: AuthenticatedUser,
    filters: LogQueryFilters,
  ): Record<string, unknown> {
    const baseFilters: Record<string, unknown> = {};

    if (filters.actorUserId !== undefined) {
      baseFilters.actorUserId = filters.actorUserId;
    }

    if (filters.actionType !== undefined) {
      baseFilters.actionType = filters.actionType;
    }

    if (filters.targetType !== undefined) {
      baseFilters.targetType = filters.targetType;
    }

    if (filters.targetId !== undefined) {
      baseFilters.targetId = filters.targetId;
    }

    if (hasFullAccess(authUser)) {
      return baseFilters;
    }

    const readableTargets = readableTargetTypes(authUser);
    const actorIsSelf = filters.actorUserId === authUser.id;

    if (filters.targetType !== undefined) {
      const resource = TARGET_TYPE_TO_RESOURCE[filters.targetType];
      const targetReadable =
        resource !== undefined &&
        hasPermission(authUser.roles, { resource, action: 'read' });

      if (!targetReadable && !actorIsSelf) {
        throw new AuthorizationError();
      }

      return baseFilters;
    }

    if (filters.actorUserId !== undefined) {
      if (actorIsSelf) {
        return baseFilters;
      }

      return {
        ...baseFilters,
        targetType: { in: readableTargets },
      };
    }

    return {
      ...baseFilters,
      OR: [
        { actorUserId: authUser.id },
        { targetType: { in: readableTargets } },
      ],
    };
  }
}

function hasFullAccess(authUser: AuthenticatedUser): boolean {
  return authUser.roles.some((role) => role === 'ADMIN' || role === 'FINANCE');
}

function readableTargetTypes(authUser: AuthenticatedUser): string[] {
  return Object.entries(TARGET_TYPE_TO_RESOURCE)
    .filter(([, resource]) =>
      hasPermission(authUser.roles, { resource, action: 'read' }),
    )
    .map(([targetType]) => targetType);
}
