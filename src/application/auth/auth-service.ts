import { DomainRuleError } from '@/domain/shared/errors.js';
import type { Role, UserStatus } from '@/domain/shared/types.js';
import { hashPassword, verifyPassword } from '@/domain/auth/password.js';
import {
  hashToken,
  issueAccessToken,
  issueRefreshToken,
  verifyAccessToken,
} from '@/domain/auth/tokens.js';
import type { ActionLogWriter } from '@/application/shared/action-log-writer.js';

const MAX_FAILED_LOGIN_COUNT = 5;
const LOCKOUT_MS = 30 * 60 * 1000;

export interface AuthServiceConfig {
  jwtSecret: string;
}

export interface LoginInput {
  loginId: string;
  password: string;
  deviceInfo?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface AuthenticatedUser {
  id: string;
  employeeId: string;
  email: string;
  loginId: string;
  displayName: string;
  status: UserStatus;
  roles: Role[];
}

export interface LoginResult {
  user: AuthenticatedUser;
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

export interface AccessTokenResult {
  user: AuthenticatedUser;
  accessToken: string;
  accessTokenExpiresAt: Date;
}

export interface LogoutInput {
  refreshToken: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface UpdateProfileInput {
  userId: string;
  displayName?: string;
  profileImageUrl?: string | null;
}

export interface ChangePasswordInput {
  userId: string;
  currentPassword: string;
  newPassword: string;
}

interface StoredUser {
  id: string;
  employeeId: string;
  email: string;
  loginId: string;
  passwordHash: string;
  displayName: string;
  profileImageUrl?: string | null;
  status: UserStatus;
  failedLoginCount: number;
  lockedUntil: Date | null;
  roles: { role: Role }[];
}

interface StoredRefreshToken {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  user: StoredUser;
}

interface AuthRepository {
  user: {
    findUnique(args: {
      where: { loginId?: string; id?: string };
      include: { roles: true };
    }): Promise<StoredUser | null>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<unknown>;
  };
  refreshToken: {
    findUnique(args: {
      where: { tokenHash: string };
      include: { user: { include: { roles: true } } };
    }): Promise<StoredRefreshToken | null>;
    create(args: {
      data: {
        userId: string;
        tokenHash: string;
        deviceInfo?: string;
        ipAddress?: string;
        userAgent?: string;
        expiresAt: Date;
      };
    }): Promise<unknown>;
    update(args: {
      where: { id: string };
      data: { revokedAt: Date };
    }): Promise<unknown>;
  };
}

export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly actionLogWriter: ActionLogWriter,
    private readonly config: AuthServiceConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async login(input: LoginInput): Promise<LoginResult> {
    const loginId = normalizeLoginId(input.loginId);
    const user = await this.repository.user.findUnique({
      where: { loginId },
      include: { roles: true },
    });

    if (!user) {
      throw invalidCredentials();
    }

    this.assertUserCanLogin(user);

    const isPasswordValid = await verifyPassword(input.password, user.passwordHash);

    if (!isPasswordValid) {
      await this.recordFailedLogin(user);
      throw invalidCredentials();
    }

    const roles = user.roles.map((role) => role.role);
    const accessToken = issueAccessToken(
      {
        sub: user.id,
        email: user.email,
        roles,
      },
      this.config.jwtSecret,
      this.now(),
    );
    const refreshToken = issueRefreshToken(this.now());

    await this.repository.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: this.now(),
      },
    });
    await this.repository.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: refreshToken.tokenHash,
        deviceInfo: input.deviceInfo,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        expiresAt: refreshToken.expiresAt,
      },
    });
    await this.actionLogWriter.write({
      actorUserId: user.id,
      actionType: 'USER_LOGIN',
      targetType: 'User',
      targetId: user.id,
      metadataJson: input.deviceInfo ? { deviceInfo: input.deviceInfo } : undefined,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    return {
      user: {
        id: user.id,
        employeeId: user.employeeId,
        email: user.email,
        loginId: user.loginId,
        displayName: user.displayName,
        status: user.status,
        roles,
      },
      accessToken: accessToken.token,
      accessTokenExpiresAt: accessToken.expiresAt,
      refreshToken: refreshToken.token,
      refreshTokenExpiresAt: refreshToken.expiresAt,
    };
  }

  async refresh(refreshToken: string): Promise<AccessTokenResult> {
    const storedToken = await this.repository.refreshToken.findUnique({
      where: { tokenHash: hashToken(refreshToken) },
      include: { user: { include: { roles: true } } },
    });

    if (!storedToken || storedToken.revokedAt) {
      throw invalidRefreshToken();
    }

    if (storedToken.expiresAt <= this.now()) {
      throw new DomainRuleError('REFRESH_TOKEN_EXPIRED', 'Refresh token is expired', 401);
    }

    this.assertUserCanLogin(storedToken.user);

    return this.issueAccessTokenForUser(storedToken.user);
  }

  async currentUser(accessToken: string): Promise<AuthenticatedUser> {
    const payload = verifyAccessTokenOrThrow(accessToken, this.config.jwtSecret, this.now());
    const user = await this.repository.user.findUnique({
      where: { id: payload.sub },
      include: { roles: true },
    });

    if (!user) {
      throw invalidAccessToken();
    }

    this.assertUserCanLogin(user);

    return toAuthenticatedUser(user);
  }

  async logout(input: LogoutInput): Promise<{ revoked: true }> {
    const storedToken = await this.repository.refreshToken.findUnique({
      where: { tokenHash: hashToken(input.refreshToken) },
      include: { user: { include: { roles: true } } },
    });

    if (!storedToken || storedToken.revokedAt) {
      throw invalidRefreshToken();
    }

    await this.repository.refreshToken.update({
      where: { id: storedToken.id },
      data: { revokedAt: this.now() },
    });
    await this.actionLogWriter.write({
      actorUserId: storedToken.userId,
      actionType: 'USER_LOGOUT',
      targetType: 'User',
      targetId: storedToken.userId,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    return { revoked: true };
  }

  async updateProfile(input: UpdateProfileInput): Promise<AuthenticatedUser> {
    const user = await this.findActiveUserById(input.userId);
    const data: Record<string, unknown> = {};

    if (input.displayName !== undefined) {
      const displayName = input.displayName.trim();

      if (displayName === '') {
        throw new DomainRuleError('INVALID_DISPLAY_NAME', 'Display name is required', 400);
      }

      data.displayName = displayName;
    }

    if (input.profileImageUrl !== undefined) {
      data.profileImageUrl = normalizeOptionalUrl(input.profileImageUrl);
    }

    if (Object.keys(data).length === 0) {
      return toAuthenticatedUser(user);
    }

    await this.repository.user.update({
      where: { id: input.userId },
      data,
    });

    const updatedUser = {
      ...user,
      ...data,
    };

    return toAuthenticatedUser(updatedUser);
  }

  async changePassword(input: ChangePasswordInput): Promise<{ changed: true }> {
    const user = await this.findActiveUserById(input.userId);
    const isCurrentPasswordValid = await verifyPassword(input.currentPassword, user.passwordHash);

    if (!isCurrentPasswordValid) {
      throw new DomainRuleError('INVALID_CURRENT_PASSWORD', 'Current password is invalid', 401);
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

    await this.repository.user.update({
      where: { id: input.userId },
      data: { passwordHash },
    });

    return { changed: true };
  }

  private assertUserCanLogin(user: StoredUser): void {
    if (user.status !== 'ACTIVE') {
      throw new DomainRuleError('USER_INACTIVE', 'User is not active', 403);
    }

    const now = this.now();

    if (user.lockedUntil && user.lockedUntil > now) {
      throw new DomainRuleError('ACCOUNT_LOCKED', 'Account is temporarily locked', 423);
    }
  }

  private async recordFailedLogin(user: StoredUser): Promise<void> {
    const failedLoginCount = user.failedLoginCount + 1;
    const lockedUntil =
      failedLoginCount >= MAX_FAILED_LOGIN_COUNT
        ? new Date(this.now().getTime() + LOCKOUT_MS)
        : null;

    await this.repository.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount,
        ...(lockedUntil && { lockedUntil }),
      },
    });
  }

  private issueAccessTokenForUser(user: StoredUser): AccessTokenResult {
    const roles = user.roles.map((role) => role.role);
    const accessToken = issueAccessToken(
      {
        sub: user.id,
        email: user.email,
        roles,
      },
      this.config.jwtSecret,
      this.now(),
    );

    return {
      user: toAuthenticatedUser(user),
      accessToken: accessToken.token,
      accessTokenExpiresAt: accessToken.expiresAt,
    };
  }

  private async findActiveUserById(userId: string): Promise<StoredUser> {
    const user = await this.repository.user.findUnique({
      where: { id: userId },
      include: { roles: true },
    });

    if (!user) {
      throw invalidAccessToken();
    }

    this.assertUserCanLogin(user);

    return user;
  }
}

function normalizeLoginId(loginId: string): string {
  return loginId.trim().toLowerCase();
}

function normalizeOptionalUrl(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const trimmed = value.trim();

  return trimmed === '' ? null : trimmed;
}

function invalidCredentials(): DomainRuleError {
  return new DomainRuleError('INVALID_CREDENTIALS', 'Invalid email or password', 401);
}

function invalidAccessToken(): DomainRuleError {
  return new DomainRuleError('INVALID_ACCESS_TOKEN', 'Invalid access token', 401);
}

function invalidRefreshToken(): DomainRuleError {
  return new DomainRuleError('INVALID_REFRESH_TOKEN', 'Invalid refresh token', 401);
}

function verifyAccessTokenOrThrow(token: string, secret: string, now: Date) {
  try {
    return verifyAccessToken(token, secret, now);
  } catch {
    throw invalidAccessToken();
  }
}

function toAuthenticatedUser(user: StoredUser): AuthenticatedUser {
  return {
    id: user.id,
    employeeId: user.employeeId,
    email: user.email,
    loginId: user.loginId,
    displayName: user.displayName,
    status: user.status,
    roles: user.roles.map((role) => role.role),
  };
}
