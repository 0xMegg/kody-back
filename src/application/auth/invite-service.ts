import { randomBytes } from 'node:crypto';
import { DomainRuleError } from '@/domain/shared/errors.js';
import type { EmployeeStatus, Role } from '@/domain/shared/types.js';
import { hashPassword } from '@/domain/auth/password.js';
import { hashInviteToken } from '@/domain/auth/tokens.js';
import {
  DevOutboxInviteEmailSender,
  type InviteEmailDelivery,
  type InviteEmailSender,
} from './invite-email-sender.js';

const INVITE_TTL_MS = 72 * 60 * 60 * 1000;
const RAW_TOKEN_BYTES = 48;
const VALID_ROLES: readonly Role[] = ['ADMIN', 'SALES', 'OPERATIONS', 'WAREHOUSE', 'FINANCE'];

export interface CreateInviteInput {
  actorUserId: string;
  email: string;
  employeeId?: string;
  roles: Role[];
}

export interface ResendInviteInput {
  actorUserId: string;
  email: string;
}

export interface ConsumeInviteInput {
  token: string;
  loginId: string;
  password: string;
  displayName: string;
}

export interface ConsumedUser {
  id: string;
  employeeId: string;
  email: string;
  loginId: string;
  displayName: string;
  status: 'ACTIVE';
  roles: Role[];
}

export interface ConsumeInviteResult {
  user: ConsumedUser;
}

export interface InviteResult {
  id: string;
  email: string;
  expiresAt: Date;
  token: string;
  roles: Role[];
  delivery: InviteEmailDelivery;
}

export interface InviteValidationResult {
  email: string;
  expiresAt: Date;
  roles: Role[];
}

interface StoredEmployee {
  id: string;
  email: string;
  status: EmployeeStatus;
}

interface StoredUserRow {
  id: string;
  employeeId: string;
  email: string;
  loginId: string;
}

interface StoredInviteToken {
  id: string;
  email: string;
  tokenHash: string;
  invitedByUserId: string;
  expiresAt: Date;
  usedAt: Date | null;
  roles?: Array<{ role: Role }>;
}

interface CreatedUserRow {
  id: string;
  employeeId: string;
  email: string;
  loginId: string;
  displayName: string;
  status: 'ACTIVE';
}

interface InviteRepository {
  employee: {
    findUnique(args: { where: { email: string } }): Promise<StoredEmployee | null>;
  };
  user: {
    findFirst(args: {
      where: { OR: Array<{ employeeId: string } | { email: string } | { loginId: string }> };
    }): Promise<StoredUserRow | null>;
    create(args: {
      data: {
        employeeId: string;
        email: string;
        loginId: string;
        passwordHash: string;
        displayName: string;
        status: 'ACTIVE';
      };
    }): Promise<CreatedUserRow>;
  };
  userRole: {
    createMany(args: {
      data: Array<{ userId: string; role: Role }>;
      skipDuplicates: true;
    }): Promise<{ count: number }>;
  };
  inviteToken: {
    findUnique(args: {
      where: { tokenHash: string };
      include?: { roles: { select: { role: true } } };
    }): Promise<StoredInviteToken | null>;
    findFirst(args: {
      where: { email: string; usedAt: null };
      include?: { roles: { select: { role: true } } };
    }): Promise<StoredInviteToken | null>;
    create(args: {
      data: {
        email: string;
        tokenHash: string;
        invitedByUserId: string;
        expiresAt: Date;
        usedAt: Date | null;
        roles: { create: Array<{ role: Role }> };
      };
    }): Promise<StoredInviteToken>;
    update(args: {
      where: { id: string };
      data: { usedAt: Date };
    }): Promise<StoredInviteToken>;
    updateMany(args: {
      where: { email: string; usedAt: null };
      data: { usedAt: Date };
    }): Promise<{ count: number }>;
  };
  $transaction<T>(
    operations: ReadonlyArray<Promise<unknown>> | ((tx: InviteRepository) => Promise<T>),
  ): Promise<unknown[] | T>;
}

export class InviteService {
  constructor(
    private readonly repository: InviteRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly emailSender: InviteEmailSender = new DevOutboxInviteEmailSender(),
    private readonly appOrigin: string = 'http://localhost:3000',
  ) {}

  async createInvite(input: CreateInviteInput): Promise<InviteResult> {
    const email = normalizeEmail(input.email);
    const roles = normalizeRoles(input.roles);
    const employee = await this.assertEmployeeAvailable(email, input.employeeId);
    await this.assertUserDoesNotExist(employee.id, email);

    return this.issueInvite(email, input.actorUserId, roles);
  }

  async resendInvite(input: ResendInviteInput): Promise<InviteResult> {
    const email = normalizeEmail(input.email);
    const employee = await this.assertEmployeeAvailable(email, undefined);
    await this.assertUserDoesNotExist(employee.id, email);

    const priorInvite = await this.repository.inviteToken.findFirst({
      where: { email, usedAt: null },
      include: { roles: { select: { role: true } } },
    });

    if (!priorInvite) {
      throw new DomainRuleError('INVITE_NOT_FOUND', 'No prior invite to resend', 404);
    }

    await this.repository.inviteToken.updateMany({
      where: { email, usedAt: null },
      data: { usedAt: this.now() },
    });

    return this.issueInvite(email, input.actorUserId, this.inviteRoles(priorInvite));
  }

  async validateInvite(token: string): Promise<InviteValidationResult> {
    const invite = await this.findInviteByToken(token);

    return { email: invite.email, expiresAt: invite.expiresAt, roles: this.inviteRoles(invite) };
  }

  async consumeInvite(input: ConsumeInviteInput): Promise<ConsumeInviteResult> {
    const invite = await this.findInviteByToken(input.token);
    const roles = this.inviteRoles(invite);
    const employee = await this.assertEmployeeAvailable(invite.email, undefined);
    await this.assertUserDoesNotExist(employee.id, invite.email);

    const loginId = normalizeLoginId(input.loginId);
    const displayName = input.displayName.trim();

    if (loginId === '') {
      throw new DomainRuleError('INVALID_LOGIN_ID', 'Login ID is required', 400);
    }

    if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(loginId)) {
      throw new DomainRuleError(
        'INVALID_LOGIN_ID',
        'Login ID must be 3-32 lowercase letters, numbers, dots, underscores, or hyphens',
        400,
      );
    }

    await this.assertLoginIdAvailable(loginId);

    if (displayName === '') {
      throw new DomainRuleError('INVALID_DISPLAY_NAME', 'Display name is required', 400);
    }

    let passwordHash: string;

    try {
      passwordHash = await hashPassword(input.password);
    } catch (error) {
      throw new DomainRuleError(
        'PASSWORD_POLICY_FAILED',
        error instanceof Error ? error.message : 'Password does not meet policy',
        400,
      );
    }

    let createdUser: CreatedUserRow;

    try {
      createdUser = (await this.repository.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            employeeId: employee.id,
            email: invite.email,
            loginId,
            passwordHash,
            displayName,
            status: 'ACTIVE',
          },
        });
        await tx.userRole.createMany({
          data: roles.map((role) => ({ userId: user.id, role })),
          skipDuplicates: true,
        });
        await tx.inviteToken.update({
          where: { id: invite.id },
          data: { usedAt: this.now() },
        });
        return user;
      })) as CreatedUserRow;
    } catch (error) {
      if (isLoginIdUniqueConstraintError(error)) {
        throw loginIdAlreadyExists();
      }

      throw error;
    }

    return {
      user: {
        id: createdUser.id,
        employeeId: employee.id,
        email: invite.email,
        loginId: createdUser.loginId,
        displayName,
        status: 'ACTIVE',
        roles,
      },
    };
  }

  private async findInviteByToken(token: string): Promise<StoredInviteToken> {
    const invite = await this.repository.inviteToken.findUnique({
      where: { tokenHash: hashInviteToken(token) },
      include: { roles: { select: { role: true } } },
    });

    if (!invite) {
      throw new DomainRuleError('INVITE_TOKEN_INVALID', 'Invite token is invalid', 400);
    }

    if (invite.usedAt !== null) {
      throw new DomainRuleError('INVITE_TOKEN_USED', 'Invite token has already been used', 410);
    }

    if (invite.expiresAt.getTime() <= this.now().getTime()) {
      throw new DomainRuleError('INVITE_TOKEN_EXPIRED', 'Invite token is expired', 410);
    }

    return invite;
  }

  private async assertEmployeeAvailable(
    email: string,
    employeeId: string | undefined,
  ): Promise<StoredEmployee> {
    const employee = await this.repository.employee.findUnique({ where: { email } });

    if (!employee) {
      throw new DomainRuleError('EMPLOYEE_NOT_FOUND', 'Employee not found', 404);
    }

    if (employeeId !== undefined && employeeId !== employee.id) {
      throw new DomainRuleError('EMPLOYEE_NOT_FOUND', 'Employee not found', 404);
    }

    if (employee.status !== 'ACTIVE') {
      throw new DomainRuleError('EMPLOYEE_INACTIVE', 'Employee is not active', 403);
    }

    return employee;
  }

  private async assertUserDoesNotExist(employeeId: string, email: string): Promise<void> {
    const existing = await this.repository.user.findFirst({
      where: { OR: [{ employeeId }, { email }] },
    });

    if (existing) {
      throw new DomainRuleError('USER_ALREADY_EXISTS', 'User already exists', 409);
    }
  }

  private async assertLoginIdAvailable(loginId: string): Promise<void> {
    const existing = await this.repository.user.findFirst({
      where: { OR: [{ loginId }] },
    });

    if (existing) {
      throw loginIdAlreadyExists();
    }
  }

  private async issueInvite(email: string, actorUserId: string, roles: Role[]): Promise<InviteResult> {
    const token = randomBytes(RAW_TOKEN_BYTES).toString('base64url');
    const tokenHash = hashInviteToken(token);
    const expiresAt = new Date(this.now().getTime() + INVITE_TTL_MS);
    const invite = await this.repository.inviteToken.create({
      data: {
        email,
        tokenHash,
        invitedByUserId: actorUserId,
        expiresAt,
        usedAt: null,
        roles: { create: roles.map((role) => ({ role })) },
      },
    });
    const delivery = await this.emailSender.sendInviteEmail({
      to: email,
      signupUrl: `${this.appOrigin.replace(/\/$/, '')}/signup?token=${encodeURIComponent(token)}`,
      expiresAt,
      roles,
    });

    return {
      id: invite.id,
      email: invite.email,
      expiresAt: invite.expiresAt,
      token,
      roles,
      delivery,
    };
  }

  private inviteRoles(invite: StoredInviteToken): Role[] {
    return normalizeRoles((invite.roles ?? []).map((row) => row.role));
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeLoginId(loginId: string): string {
  return loginId.trim().toLowerCase();
}

function normalizeRoles(roles: readonly Role[]): Role[] {
  const unique = Array.from(new Set(roles));
  if (unique.length === 0) {
    throw new DomainRuleError('INVALID_INVITE_ROLES', 'At least one role is required', 400);
  }
  if (!unique.every((role) => VALID_ROLES.includes(role))) {
    throw new DomainRuleError('INVALID_INVITE_ROLES', 'roles contains an invalid value', 400);
  }
  return unique;
}

function loginIdAlreadyExists(): DomainRuleError {
  return new DomainRuleError('LOGIN_ID_ALREADY_EXISTS', 'Login ID already exists', 409);
}

function isLoginIdUniqueConstraintError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }

  const prismaError = error as { code?: unknown; meta?: { target?: unknown } };

  if (prismaError.code !== 'P2002') {
    return false;
  }

  const target = prismaError.meta?.target;

  if (Array.isArray(target)) {
    return target.includes('loginId');
  }

  return typeof target === 'string' && target.includes('loginId');
}
