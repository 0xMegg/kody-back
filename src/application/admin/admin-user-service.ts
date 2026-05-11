import { DomainRuleError } from '@/domain/shared/errors.js';
import type { EmployeeStatus, Role, UserStatus } from '@/domain/shared/types.js';
import type { ActionLogWriter } from '@/application/shared/action-log-writer.js';

const ROLES: readonly Role[] = ['ADMIN', 'SALES', 'OPERATIONS', 'WAREHOUSE', 'FINANCE'];
const USER_STATUSES: readonly UserStatus[] = ['ACTIVE', 'SUSPENDED', 'INACTIVE'];

export interface AdminUserSummary {
  id: string;
  employeeId: string;
  email: string;
  displayName: string;
  profileImageUrl?: string | null;
  status: UserStatus;
  failedLoginCount: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
  roles: Role[];
  employee: {
    id: string;
    name: string;
    email: string;
    phone?: string | null;
    department?: string | null;
    position?: string | null;
    status: EmployeeStatus;
  };
}

export interface UpdateUserStatusInput {
  actorUserId: string;
  userId: string;
  status: UserStatus;
  reason?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface ReplaceUserRolesInput {
  actorUserId: string;
  userId: string;
  roles: Role[];
  reason?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface UnlockUserInput {
  userId: string;
}

interface StoredEmployee {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  department?: string | null;
  position?: string | null;
  status: EmployeeStatus;
}

interface StoredUser {
  id: string;
  employeeId: string;
  email: string;
  displayName: string;
  profileImageUrl?: string | null;
  status: UserStatus;
  failedLoginCount: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
  roles: { role: Role }[];
  employee: StoredEmployee;
}

interface AdminUserRepository {
  user: {
    findMany(args: {
      include: { employee: true; roles: true };
      orderBy: { createdAt: 'asc' | 'desc' };
    }): Promise<StoredUser[]>;
    findUnique(args: {
      where: { id: string };
      include: { employee: true; roles: true };
    }): Promise<StoredUser | null>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
      include: { employee: true; roles: true };
    }): Promise<StoredUser>;
  };
}

export class AdminUserService {
  constructor(
    private readonly repository: AdminUserRepository,
    private readonly actionLogWriter: ActionLogWriter,
  ) {}

  async listUsers(): Promise<AdminUserSummary[]> {
    const users = await this.repository.user.findMany({
      include: { employee: true, roles: true },
      orderBy: { createdAt: 'desc' },
    });

    return users.map(toAdminUserSummary);
  }

  async getUser(userId: string): Promise<AdminUserSummary> {
    return toAdminUserSummary(await this.findUser(userId));
  }

  async updateStatus(input: UpdateUserStatusInput): Promise<AdminUserSummary> {
    const status = normalizeUserStatus(input.status);
    const user = await this.findUser(input.userId);

    if (user.status === status) {
      return toAdminUserSummary(user);
    }

    const updatedUser = await this.repository.user.update({
      where: { id: input.userId },
      data: { status },
      include: { employee: true, roles: true },
    });

    await this.actionLogWriter.write({
      actorUserId: input.actorUserId,
      actionType: 'USER_STATUS_CHANGE',
      targetType: 'User',
      targetId: input.userId,
      beforeJson: { status: user.status },
      afterJson: { status },
      metadataJson: input.reason ? { reason: input.reason } : undefined,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    return toAdminUserSummary(updatedUser);
  }

  async replaceRoles(input: ReplaceUserRolesInput): Promise<AdminUserSummary> {
    const roles = normalizeRoles(input.roles);
    const user = await this.findUser(input.userId);
    const previousRoles = user.roles.map((role) => role.role);

    if (sameRoleSet(previousRoles, roles)) {
      return toAdminUserSummary(user);
    }

    const updatedUser = await this.repository.user.update({
      where: { id: input.userId },
      data: {
        roles: {
          deleteMany: {},
          create: roles.map((role) => ({ role })),
        },
      },
      include: { employee: true, roles: true },
    });

    await this.actionLogWriter.write({
      actorUserId: input.actorUserId,
      actionType: 'USER_ROLE_CHANGE',
      targetType: 'User',
      targetId: input.userId,
      beforeJson: { roles: previousRoles },
      afterJson: { roles },
      metadataJson: input.reason ? { reason: input.reason } : undefined,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    return toAdminUserSummary(updatedUser);
  }

  async unlockUser(input: UnlockUserInput): Promise<AdminUserSummary> {
    const user = await this.findUser(input.userId);

    if (user.failedLoginCount === 0 && user.lockedUntil === null) {
      return toAdminUserSummary(user);
    }

    const updatedUser = await this.repository.user.update({
      where: { id: input.userId },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
      },
      include: { employee: true, roles: true },
    });

    return toAdminUserSummary(updatedUser);
  }

  private async findUser(userId: string): Promise<StoredUser> {
    const user = await this.repository.user.findUnique({
      where: { id: userId },
      include: { employee: true, roles: true },
    });

    if (!user) {
      throw new DomainRuleError('USER_NOT_FOUND', 'User not found', 404);
    }

    return user;
  }
}

function normalizeUserStatus(status: UserStatus): UserStatus {
  if (!USER_STATUSES.includes(status)) {
    throw new DomainRuleError('INVALID_USER_STATUS', 'Invalid user status', 400);
  }

  return status;
}

function normalizeRoles(roles: Role[]): Role[] {
  if (!Array.isArray(roles) || roles.length === 0) {
    throw new DomainRuleError('INVALID_USER_ROLES', 'At least one role is required', 400);
  }

  const normalizedRoles = [...new Set(roles)];

  if (normalizedRoles.some((role) => !ROLES.includes(role))) {
    throw new DomainRuleError('INVALID_USER_ROLES', 'Invalid user role', 400);
  }

  return normalizedRoles;
}

function sameRoleSet(left: Role[], right: Role[]): boolean {
  return left.length === right.length && left.every((role) => right.includes(role));
}

function toAdminUserSummary(user: StoredUser): AdminUserSummary {
  return {
    id: user.id,
    employeeId: user.employeeId,
    email: user.email,
    displayName: user.displayName,
    profileImageUrl: user.profileImageUrl,
    status: user.status,
    failedLoginCount: user.failedLoginCount,
    lockedUntil: user.lockedUntil,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    roles: user.roles.map((role) => role.role),
    employee: {
      id: user.employee.id,
      name: user.employee.name,
      email: user.employee.email,
      phone: user.employee.phone,
      department: user.employee.department,
      position: user.employee.position,
      status: user.employee.status,
    },
  };
}
