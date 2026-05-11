import { randomBytes } from 'node:crypto';
import { DomainRuleError } from '@/domain/shared/errors.js';
import type { EmployeeStatus } from '@/domain/shared/types.js';
import { hashPassword } from '@/domain/auth/password.js';
import { hashInviteToken } from '@/domain/auth/tokens.js';

const INVITE_TTL_MS = 72 * 60 * 60 * 1000;
const RAW_TOKEN_BYTES = 48;

export interface CreateInviteInput {
  actorUserId: string;
  email: string;
  employeeId?: string;
}

export interface ResendInviteInput {
  actorUserId: string;
  email: string;
}

export interface ConsumeInviteInput {
  token: string;
  password: string;
  displayName: string;
}

export interface ConsumedUser {
  id: string;
  employeeId: string;
  email: string;
  displayName: string;
  status: 'ACTIVE';
  roles: [];
}

export interface ConsumeInviteResult {
  user: ConsumedUser;
}

export interface InviteResult {
  id: string;
  email: string;
  expiresAt: Date;
  token: string;
}

export interface InviteValidationResult {
  email: string;
  expiresAt: Date;
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
}

interface StoredInviteToken {
  id: string;
  email: string;
  tokenHash: string;
  invitedByUserId: string;
  expiresAt: Date;
  usedAt: Date | null;
}

interface CreatedUserRow {
  id: string;
  employeeId: string;
  email: string;
  displayName: string;
  status: 'ACTIVE';
}

interface InviteRepository {
  employee: {
    findUnique(args: { where: { email: string } }): Promise<StoredEmployee | null>;
  };
  user: {
    findFirst(args: {
      where: { OR: Array<{ employeeId: string } | { email: string }> };
    }): Promise<StoredUserRow | null>;
    create(args: {
      data: {
        employeeId: string;
        email: string;
        passwordHash: string;
        displayName: string;
        status: 'ACTIVE';
      };
    }): Promise<CreatedUserRow>;
  };
  inviteToken: {
    findUnique(args: {
      where: { tokenHash: string };
    }): Promise<StoredInviteToken | null>;
    findFirst(args: {
      where: { email: string; usedAt: null };
    }): Promise<StoredInviteToken | null>;
    create(args: {
      data: {
        email: string;
        tokenHash: string;
        invitedByUserId: string;
        expiresAt: Date;
        usedAt: Date | null;
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
  $transaction(operations: ReadonlyArray<Promise<unknown>>): Promise<unknown[]>;
}

export class InviteService {
  constructor(
    private readonly repository: InviteRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createInvite(input: CreateInviteInput): Promise<InviteResult> {
    const email = normalizeEmail(input.email);
    const employee = await this.assertEmployeeAvailable(email, input.employeeId);
    await this.assertUserDoesNotExist(employee.id, email);

    return this.issueInvite(email, input.actorUserId);
  }

  async resendInvite(input: ResendInviteInput): Promise<InviteResult> {
    const email = normalizeEmail(input.email);
    const employee = await this.assertEmployeeAvailable(email, undefined);
    await this.assertUserDoesNotExist(employee.id, email);

    const priorInvite = await this.repository.inviteToken.findFirst({
      where: { email, usedAt: null },
    });

    if (!priorInvite) {
      throw new DomainRuleError('INVITE_NOT_FOUND', 'No prior invite to resend', 404);
    }

    await this.repository.inviteToken.updateMany({
      where: { email, usedAt: null },
      data: { usedAt: this.now() },
    });

    return this.issueInvite(email, input.actorUserId);
  }

  async validateInvite(token: string): Promise<InviteValidationResult> {
    const invite = await this.findInviteByToken(token);

    return { email: invite.email, expiresAt: invite.expiresAt };
  }

  async consumeInvite(input: ConsumeInviteInput): Promise<ConsumeInviteResult> {
    const invite = await this.findInviteByToken(input.token);
    const employee = await this.assertEmployeeAvailable(invite.email, undefined);
    await this.assertUserDoesNotExist(employee.id, invite.email);

    const displayName = input.displayName.trim();

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

    const results = await this.repository.$transaction([
      this.repository.user.create({
        data: {
          employeeId: employee.id,
          email: invite.email,
          passwordHash,
          displayName,
          status: 'ACTIVE',
        },
      }),
      this.repository.inviteToken.update({
        where: { id: invite.id },
        data: { usedAt: this.now() },
      }),
    ]);
    const createdUser = results[0] as CreatedUserRow;

    return {
      user: {
        id: createdUser.id,
        employeeId: employee.id,
        email: invite.email,
        displayName,
        status: 'ACTIVE',
        roles: [],
      },
    };
  }

  private async findInviteByToken(token: string): Promise<StoredInviteToken> {
    const invite = await this.repository.inviteToken.findUnique({
      where: { tokenHash: hashInviteToken(token) },
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

  private async issueInvite(email: string, actorUserId: string): Promise<InviteResult> {
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
      },
    });

    return {
      id: invite.id,
      email: invite.email,
      expiresAt: invite.expiresAt,
      token,
    };
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
