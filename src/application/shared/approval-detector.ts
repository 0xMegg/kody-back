export type ApprovalFailureReason =
  | 'MISSING_APPROVAL'
  | 'MALFORMED_APPROVAL_RECORD'
  | 'APPROVAL_EXPIRED'
  | 'APPROVAL_SCOPE_MISMATCH';

export interface ApprovalRecord {
  approved: boolean;
  scope: string | readonly string[];
  expiresAt: string | Date;
  approvedAt?: string | Date;
  approvedBy?: string;
}

export interface DetectApprovalInput {
  explicitApproval?: boolean;
  approvalRecord?: unknown;
  requiredScope: string;
  now?: Date;
}

export type ApprovalDetectionResult =
  | { approved: true; source: 'explicit_flag' }
  | {
      approved: true;
      source: 'approval_record';
      scope: string;
      approvedBy?: string;
      expiresAt: string;
    }
  | { approved: false; reason: ApprovalFailureReason };

export function detectApproval(input: DetectApprovalInput): ApprovalDetectionResult {
  if (input.explicitApproval === true) {
    return { approved: true, source: 'explicit_flag' };
  }

  if (input.approvalRecord === undefined || input.approvalRecord === null) {
    return { approved: false, reason: 'MISSING_APPROVAL' };
  }

  if (!isApprovalRecordShape(input.approvalRecord)) {
    return { approved: false, reason: 'MALFORMED_APPROVAL_RECORD' };
  }

  const record = input.approvalRecord;
  const expiresAt = parseDate(record.expiresAt);
  const approvedAt = record.approvedAt === undefined ? undefined : parseDate(record.approvedAt);
  const scopes = normalizeScopes(record.scope);

  if (
    record.approved !== true
    || expiresAt === null
    || (record.approvedAt !== undefined && approvedAt === null)
    || scopes.length === 0
    || !isValidRequiredScope(input.requiredScope)
  ) {
    return { approved: false, reason: 'MALFORMED_APPROVAL_RECORD' };
  }

  const now = input.now ?? new Date();
  if (expiresAt.getTime() <= now.getTime()) {
    return { approved: false, reason: 'APPROVAL_EXPIRED' };
  }

  if (!scopes.includes(input.requiredScope)) {
    return { approved: false, reason: 'APPROVAL_SCOPE_MISMATCH' };
  }

  return {
    approved: true,
    source: 'approval_record',
    scope: input.requiredScope,
    ...(record.approvedBy === undefined ? {} : { approvedBy: record.approvedBy }),
    expiresAt: expiresAt.toISOString(),
  };
}

function isApprovalRecordShape(value: unknown): value is ApprovalRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  const validScope = typeof record.scope === 'string'
    || (Array.isArray(record.scope) && record.scope.every((scope) => typeof scope === 'string'));

  return (
    typeof record.approved === 'boolean'
    && validScope
    && (typeof record.expiresAt === 'string' || record.expiresAt instanceof Date)
    && (
      record.approvedAt === undefined
      || typeof record.approvedAt === 'string'
      || record.approvedAt instanceof Date
    )
    && (record.approvedBy === undefined || typeof record.approvedBy === 'string')
  );
}

function normalizeScopes(scope: string | readonly string[]): string[] {
  const scopes = Array.isArray(scope) ? scope : [scope];
  return scopes.map((item) => item.trim()).filter((item) => item.length > 0);
}

function parseDate(value: string | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isValidRequiredScope(scope: string): boolean {
  return scope.trim().length > 0;
}
