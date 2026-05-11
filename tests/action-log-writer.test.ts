import { describe, expect, it, vi } from 'vitest';
import {
  ActionLogWriter,
  type ActionLogWriteInput,
} from '@/application/shared/action-log-writer.js';

describe('ActionLogWriter', () => {
  it('forwards the input verbatim as the create data payload', async () => {
    const create = vi.fn(async () => ({}));
    const writer = new ActionLogWriter({ create });

    const input: ActionLogWriteInput = {
      actorUserId: 'user_1',
      actionType: 'USER_LOGIN',
      targetType: 'User',
      targetId: 'user_1',
      metadataJson: { deviceInfo: 'vitest' },
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
    };

    await writer.write(input);

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({ data: input });
  });

  it('preserves explicit undefined optional fields in the payload', async () => {
    const create = vi.fn(async () => ({}));
    const writer = new ActionLogWriter({ create });

    await writer.write({
      actorUserId: 'user_1',
      actionType: 'USER_LOGOUT',
      targetType: 'User',
      targetId: 'user_1',
      metadataJson: undefined,
      ipAddress: undefined,
      userAgent: undefined,
    });

    const [call] = create.mock.calls;
    const data = call?.[0]?.data as Record<string, unknown>;

    expect(Object.prototype.hasOwnProperty.call(data, 'metadataJson')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(data, 'ipAddress')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(data, 'userAgent')).toBe(true);
    expect(data.metadataJson).toBeUndefined();
    expect(data.ipAddress).toBeUndefined();
    expect(data.userAgent).toBeUndefined();
  });

  it('accepts non-auth ActionType values from the shared union', async () => {
    const create = vi.fn(async () => ({}));
    const writer = new ActionLogWriter({ create });

    await writer.write({
      actorUserId: 'user_1',
      actionType: 'ORDER_CREATE',
      targetType: 'Order',
      targetId: 'order_1',
      beforeJson: { status: 'PENDING' },
      afterJson: { status: 'CONFIRMED' },
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        actorUserId: 'user_1',
        actionType: 'ORDER_CREATE',
        targetType: 'Order',
        targetId: 'order_1',
        beforeJson: { status: 'PENDING' },
        afterJson: { status: 'CONFIRMED' },
      },
    });
  });

  it('rethrows repository write failures so callers can surface them', async () => {
    const failure = new Error('write failed');
    const create = vi.fn(async () => {
      throw failure;
    });
    const writer = new ActionLogWriter({ create });

    await expect(
      writer.write({
        actorUserId: 'user_1',
        actionType: 'USER_LOGIN',
        targetType: 'User',
        targetId: 'user_1',
      }),
    ).rejects.toBe(failure);
  });
});
