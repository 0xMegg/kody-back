import { describe, expect, it } from 'vitest';

import { detectApproval } from '@/application/shared/approval-detector.js';

const NOW = new Date('2026-06-11T00:00:00.000Z');

describe('approval detector', () => {
  it('accepts an explicit approval flag without requiring a record', () => {
    expect(detectApproval({ explicitApproval: true, requiredScope: 'product-inventory:P1', now: NOW })).toEqual({
      approved: true,
      source: 'explicit_flag',
    });
  });

  it('accepts a valid approval record for the required scope', () => {
    expect(detectApproval({
      requiredScope: 'product-inventory:P1',
      now: NOW,
      approvalRecord: {
        approved: true,
        scope: 'product-inventory:P1',
        approvedAt: '2026-06-10T00:00:00.000Z',
        expiresAt: '2026-06-12T00:00:00.000Z',
        approvedBy: 'operator',
      },
    })).toEqual({
      approved: true,
      source: 'approval_record',
      scope: 'product-inventory:P1',
      approvedBy: 'operator',
      expiresAt: '2026-06-12T00:00:00.000Z',
    });
  });

  it('accepts a valid approval record when one of multiple scopes matches', () => {
    expect(detectApproval({
      requiredScope: 'product-inventory:P2',
      now: NOW,
      approvalRecord: {
        approved: true,
        scope: ['product-inventory:P1', 'product-inventory:P2'],
        expiresAt: '2026-06-12T00:00:00.000Z',
      },
    })).toMatchObject({ approved: true, source: 'approval_record', scope: 'product-inventory:P2' });
  });

  it('rejects missing approval inputs', () => {
    expect(detectApproval({ requiredScope: 'product-inventory:P1', now: NOW })).toEqual({
      approved: false,
      reason: 'MISSING_APPROVAL',
    });
  });

  it('rejects malformed approval records', () => {
    expect(detectApproval({
      requiredScope: 'product-inventory:P1',
      now: NOW,
      approvalRecord: { approved: true, scope: 'product-inventory:P1', expiresAt: 'not-a-date' },
    })).toEqual({
      approved: false,
      reason: 'MALFORMED_APPROVAL_RECORD',
    });
  });

  it('rejects expired approval records', () => {
    expect(detectApproval({
      requiredScope: 'product-inventory:P1',
      now: NOW,
      approvalRecord: { approved: true, scope: 'product-inventory:P1', expiresAt: '2026-06-10T23:59:59.000Z' },
    })).toEqual({
      approved: false,
      reason: 'APPROVAL_EXPIRED',
    });
  });

  it('rejects scope-mismatched approval records', () => {
    expect(detectApproval({
      requiredScope: 'product-inventory:P2',
      now: NOW,
      approvalRecord: { approved: true, scope: 'product-inventory:P1', expiresAt: '2026-06-12T00:00:00.000Z' },
    })).toEqual({
      approved: false,
      reason: 'APPROVAL_SCOPE_MISMATCH',
    });
  });
});
