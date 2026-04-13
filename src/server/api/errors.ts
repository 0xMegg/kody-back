import { DomainRuleError } from '@/domain/shared/errors.js';

// ---------------------------------------------------------------------------
// Base API error
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Subclasses
// ---------------------------------------------------------------------------

export class ValidationError extends ApiError {
  constructor(message: string = 'Validation failed') {
    super(400, 'VALIDATION_ERROR', message);
    this.name = 'ValidationError';
  }
}

export class AuthenticationError extends ApiError {
  constructor(message: string = 'Authentication required') {
    super(401, 'AUTHENTICATION_ERROR', message);
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends ApiError {
  constructor(message: string = 'Insufficient permissions') {
    super(403, 'AUTHORIZATION_ERROR', message);
    this.name = 'AuthorizationError';
  }
}

export class NotFoundError extends ApiError {
  constructor(message: string = 'Resource not found') {
    super(404, 'NOT_FOUND', message);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends ApiError {
  constructor(message: string = 'Resource conflict') {
    super(409, 'CONFLICT', message);
    this.name = 'ConflictError';
  }
}

// ---------------------------------------------------------------------------
// Conversion helper
// ---------------------------------------------------------------------------

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (error instanceof DomainRuleError) {
    return new ApiError(error.statusCode, error.code, error.message);
  }

  return new ApiError(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
}
