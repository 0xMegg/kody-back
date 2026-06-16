import type { PaginatedResult } from '@/domain/shared/types.js';

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface ApiSuccessResponse<T> {
  ok: true;
  data: T;
}

export interface ApiErrorResponse {
  ok: false;
  requestId?: string;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

export function successResponse<T>(data: T): ApiSuccessResponse<T> {
  return { ok: true, data };
}

export function errorResponse(
  code: string,
  message: string,
  details?: unknown,
  requestId?: string,
): ApiErrorResponse {
  return {
    ok: false,
    ...(requestId !== undefined && { requestId }),
    error: { code, message, ...(details !== undefined && { details }) },
  };
}

export function paginatedResponse<T>(
  data: PaginatedResult<T>,
): ApiSuccessResponse<PaginatedResult<T>> {
  return { ok: true, data };
}
