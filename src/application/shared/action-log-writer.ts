import type { ActionType } from '@/domain/shared/types.js';
import { getRequestContext } from '@/server/request-context.js';

export interface ActionLogWriteInput {
  actorUserId: string;
  actionType: ActionType;
  targetType: string;
  targetId: string;
  beforeJson?: Record<string, unknown>;
  afterJson?: Record<string, unknown>;
  metadataJson?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

export interface ActionLogRepository {
  create(args: { data: ActionLogWriteInput }): Promise<unknown>;
}

export class ActionLogWriter {
  constructor(private readonly repository: ActionLogRepository) {}

  async write(input: ActionLogWriteInput): Promise<void> {
    const requestId = getRequestContext()?.requestId;
    const data = requestId === undefined
      ? input
      : {
          ...input,
          metadataJson: { ...input.metadataJson, requestId },
        };

    await this.repository.create({ data });
  }
}
