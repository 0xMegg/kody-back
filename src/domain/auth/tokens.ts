import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  roles: string[];
  exp: number;
}

export interface IssuedAccessToken {
  token: string;
  expiresAt: Date;
}

export interface IssuedRefreshToken {
  token: string;
  tokenHash: string;
  expiresAt: Date;
}

const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function issueAccessToken(
  payload: Omit<AccessTokenPayload, 'exp'>,
  secret: string,
  now: Date = new Date(),
): IssuedAccessToken {
  const expiresAt = new Date(now.getTime() + ACCESS_TOKEN_TTL_MS);
  const body: AccessTokenPayload = {
    ...payload,
    exp: Math.floor(expiresAt.getTime() / 1000),
  };
  const encodedBody = encodeJson(body);
  const signature = sign(encodedBody, secret);

  return {
    token: `${encodedBody}.${signature}`,
    expiresAt,
  };
}

export function verifyAccessToken(token: string, secret: string, now: Date = new Date()): AccessTokenPayload {
  const [encodedBody, signature] = token.split('.');

  if (!encodedBody || !signature || !verifySignature(encodedBody, signature, secret)) {
    throw new Error('Invalid access token');
  }

  const payload = decodeJson<AccessTokenPayload>(encodedBody);

  if (payload.exp <= Math.floor(now.getTime() / 1000)) {
    throw new Error('Expired access token');
  }

  return payload;
}

export function issueRefreshToken(now: Date = new Date()): IssuedRefreshToken {
  const token = randomBytes(48).toString('base64url');
  const expiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_MS);

  return {
    token,
    tokenHash: hashToken(token),
    expiresAt,
  };
}

export function hashToken(token: string): string {
  return createHmac('sha256', 'kody-refresh-token').update(token).digest('base64url');
}

export function hashInviteToken(token: string): string {
  return createHmac('sha256', 'kody-invite-token').update(token).digest('base64url');
}

export function hashPasswordResetToken(token: string): string {
  return createHmac('sha256', 'kody-password-reset-token').update(token).digest('base64url');
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeJson<T>(value: string): T {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as T;
}

function sign(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function verifySignature(value: string, signature: string, secret: string): boolean {
  const expected = Buffer.from(sign(value, secret), 'base64url');
  const actual = Buffer.from(signature, 'base64url');

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
