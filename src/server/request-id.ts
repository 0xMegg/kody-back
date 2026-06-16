import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function isSafeRequestId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_REQUEST_ID_PATTERN.test(value);
}

export function generateRequestId(request?: IncomingMessage): string {
  const callerRequestId = firstHeaderValue(request?.headers['request-id']);

  if (isSafeRequestId(callerRequestId)) {
    return callerRequestId;
  }

  return randomUUID();
}
