import { randomBytes } from 'node:crypto';
import { DomainRuleError } from '@/domain/shared/errors.js';
import type { UserStatus } from '@/domain/shared/types.js';
import { hashPassword } from '@/domain/auth/password.js';
import { hashPasswordResetToken } from '@/domain/auth/tokens.js';

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
const RAW_TOKEN_BYTES = 48;

export interface RequestResetInput {
  email: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface RequestResetResult {
  requested: true;
  token?: string;
  expiresAt?: Date;
}

export interface ValidateResetResult {
  expiresAt: Date;
}

export interface ConsumeResetInput {
  token: string;
  newPassword: string;
}

export interface ConsumeResetResult {
  reset: true;
}

interface StoredUser {
  id: string;
  email: string;
  status: UserStatus;
  lockedUntil: Date | null;
}

interface StoredResetToken {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
}

interface PasswordResetRepository {
  user: {
    findUnique(args: { where: { email?: string; id?: string } }): Promise<StoredUser | null>;
    update(args: {
      where: { id: string };
      data: { passwordHash: string; failedLoginCount: number; lockedUntil: null };
    }): Promise<unknown>;
  };
  passwordResetToken: {
    findUnique(args: { where: { tokenHash: string } }): Promise<StoredResetToken | null>;
    create(args: {
      data: {
        userId: string;
        tokenHash: string;
        expiresAt: Date;
        usedAt: null;
        ipAddress?: string;
        userAgent?: string;
      };
    }): Promise<StoredResetToken>;
    update(args: {
      where: { id: string };
      data: { usedAt: Date };
    }): Promise<StoredResetToken>;
    updateMany(args: {
      where: { userId: string; usedAt: null };
      data: { usedAt: Date };
    }): Promise<{ count: number }>;
  };
  refreshToken: {
    updateMany(args: {
      where: { userId: string; revokedAt: null };
      data: { revokedAt: Date };
    }): Promise<{ count: number }>;
  };
  $transaction(operations: ReadonlyArray<Promise<unknown>>): Promise<unknown[]>;
}

export class PasswordResetService {
  constructor(
    private readonly repository: PasswordResetRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async requestReset(input: RequestResetInput): Promise<RequestResetResult> {
    const email = normalizeEmail(input.email);
    const user = await this.repository.user.findUnique({ where: { email } });

    if (!user || user.status !== 'ACTIVE' || isLocked(user, this.now())) {
      return { requested: true };
    }

    const issuedAt = this.now();

    await this.repository.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: issuedAt },
    });

    const token = randomBytes(RAW_TOKEN_BYTES).toString('base64url');
    const tokenHash = hashPasswordResetToken(token);
    const expiresAt = new Date(issuedAt.getTime() + RESET_TOKEN_TTL_MS);

    await this.repository.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
        usedAt: null,
        ...(input.ipAddress !== undefined && { ipAddress: input.ipAddress }),
        ...(input.userAgent !== undefined && { userAgent: input.userAgent }),
      },
    });

    return { requested: true, token, expiresAt };
  }

  async validateReset(token: string): Promise<ValidateResetResult> {
    const stored = await this.findResetTokenByRawToken(token);

    return { expiresAt: stored.expiresAt };
  }

  async consumeReset(input: ConsumeResetInput): Promise<ConsumeResetResult> {
    const stored = await this.findResetTokenByRawToken(input.token);
    const user = await this.repository.user.findUnique({ where: { id: stored.userId } });

    if (!user) {
      throw resetTokenInvalid();
    }

    if (user.status !== 'ACTIVE') {
      throw new DomainRuleError('USER_INACTIVE', 'User is not active', 403);
    }

    let passwordHash: string;

    try {
      passwordHash = await hashPassword(input.newPassword);
    } catch (error) {
      throw new DomainRuleError(
        'PASSWORD_POLICY_FAILED',
        error instanceof Error ? error.message : 'Password does not meet policy',
        400,
      );
    }

    const consumedAt = this.now();

    await this.repository.$transaction([
      this.repository.user.update({
        where: { id: user.id },
        data: { passwordHash, failedLoginCount: 0, lockedUntil: null },
      }),
      this.repository.passwordResetToken.update({
        where: { id: stored.id },
        data: { usedAt: consumedAt },
      }),
      this.repository.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: consumedAt },
      }),
    ]);

    return { reset: true };
  }

  private async findResetTokenByRawToken(token: string): Promise<StoredResetToken> {
    const stored = await this.repository.passwordResetToken.findUnique({
      where: { tokenHash: hashPasswordResetToken(token) },
    });

    if (!stored) {
      throw resetTokenInvalid();
    }

    if (stored.usedAt !== null) {
      throw new DomainRuleError('RESET_TOKEN_USED', 'Reset token has already been used', 410);
    }

    if (stored.expiresAt.getTime() <= this.now().getTime()) {
      throw new DomainRuleError('RESET_TOKEN_EXPIRED', 'Reset token is expired', 410);
    }

    return stored;
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isLocked(user: StoredUser, now: Date): boolean {
  return user.lockedUntil !== null && user.lockedUntil > now;
}

function resetTokenInvalid(): DomainRuleError {
  return new DomainRuleError('RESET_TOKEN_INVALID', 'Reset token is invalid', 400);
}
