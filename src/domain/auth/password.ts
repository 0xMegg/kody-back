import { randomBytes, scrypt as nodeScrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(nodeScrypt);

const HASH_ALGORITHM = 'scrypt';
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

export async function hashPassword(password: string): Promise<string> {
  assertPasswordPolicy(password);

  const salt = randomBytes(SALT_LENGTH).toString('base64url');
  const key = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;

  return `${HASH_ALGORITHM}$${salt}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  const [algorithm, salt, storedKey] = passwordHash.split('$');

  if (algorithm !== HASH_ALGORITHM || !salt || !storedKey) {
    return false;
  }

  const expected = Buffer.from(storedKey, 'base64url');
  const actual = (await scrypt(password, salt, expected.length)) as Buffer;

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function assertPasswordPolicy(password: string): void {
  if (password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }

  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    throw new Error('Password must include letters and numbers');
  }
}
