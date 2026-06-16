import type { ActionLogWriter } from '@/application/shared/action-log-writer.js';
import { DomainRuleError } from '@/domain/shared/errors.js';
import type { Incoterm } from '@/domain/shared/types.js';

const INCOTERMS: readonly Incoterm[] = ['EXW', 'FOB', 'CIF', 'DDP', 'DAP'];

export interface ShippingAddressSummary {
  id: string;
  accountId: string;
  label: string;
  country: string;
  fullAddress: string;
  isPrimary: boolean;
  defaultIncoterm: Incoterm | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateShippingAddressInput {
  actorUserId: string;
  accountId: string;
  label: string;
  country: string;
  fullAddress: string;
  isPrimary?: boolean;
  defaultIncoterm?: Incoterm;
  ipAddress?: string;
  userAgent?: string;
}

export interface UpdateShippingAddressInput {
  actorUserId: string;
  accountId: string;
  addressId: string;
  label?: string;
  country?: string;
  fullAddress?: string;
  isPrimary?: boolean;
  defaultIncoterm?: Incoterm | null;
  ipAddress?: string;
  userAgent?: string;
}

export interface DeleteShippingAddressInput {
  actorUserId: string;
  accountId: string;
  addressId: string;
  ipAddress?: string;
  userAgent?: string;
}

interface StoredShippingAddress {
  id: string;
  accountId: string;
  label: string;
  country: string;
  fullAddress: string;
  isPrimary: boolean;
  defaultIncoterm: Incoterm | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ShippingAddressTxClient {
  shippingAddress: {
    create(args: { data: Record<string, unknown> }): Promise<StoredShippingAddress>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<StoredShippingAddress>;
    updateMany(args: {
      where: Record<string, unknown>;
      data: { isPrimary: false };
    }): Promise<{ count: number }>;
  };
}

interface ShippingAddressRepository {
  $transaction<R>(fn: (tx: ShippingAddressTxClient) => Promise<R>): Promise<R>;
  account: {
    findUnique(args: { where: { id: string } }): Promise<{ id: string } | null>;
  };
  shippingAddress: {
    findUnique(args: { where: { id: string } }): Promise<StoredShippingAddress | null>;
    findMany(args: {
      where: { accountId: string };
      orderBy: Array<Record<string, 'asc' | 'desc'>>;
    }): Promise<StoredShippingAddress[]>;
    delete(args: { where: { id: string } }): Promise<StoredShippingAddress>;
  };
}

export class ShippingAddressService {
  constructor(
    private readonly repository: ShippingAddressRepository,
    private readonly actionLogWriter: ActionLogWriter,
  ) {}

  async createAddress(input: CreateShippingAddressInput): Promise<ShippingAddressSummary> {
    const accountId = normalizeRequiredString(input.accountId, 'accountId');
    const label = normalizeRequiredString(input.label, 'label');
    const country = normalizeRequiredString(input.country, 'country');
    const fullAddress = normalizeRequiredString(input.fullAddress, 'fullAddress');
    const isPrimary = normalizeOptionalBoolean(input.isPrimary, 'isPrimary') ?? false;
    const defaultIncoterm =
      input.defaultIncoterm === undefined ? undefined : normalizeIncoterm(input.defaultIncoterm);

    await this.assertAccountExists(accountId);

    const created = await this.repository.$transaction(async (tx) => {
      if (isPrimary) {
        await tx.shippingAddress.updateMany({
          where: { accountId, isPrimary: true },
          data: { isPrimary: false },
        });
      }

      return tx.shippingAddress.create({
        data: {
          accountId,
          label,
          country,
          fullAddress,
          isPrimary,
          ...(defaultIncoterm !== undefined ? { defaultIncoterm } : {}),
        },
      });
    });

    await this.actionLogWriter.write({
      actorUserId: normalizeRequiredString(input.actorUserId, 'actorUserId'),
      actionType: 'ACCOUNT_UPDATE',
      targetType: 'ShippingAddress',
      targetId: created.id,
      afterJson: toShippingAddressAuditPayload(created),
      metadataJson: { accountId },
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    return toShippingAddressSummary(created);
  }

  async listAddresses(accountId: string): Promise<ShippingAddressSummary[]> {
    const id = normalizeRequiredString(accountId, 'accountId');
    await this.assertAccountExists(id);

    const items = await this.repository.shippingAddress.findMany({
      where: { accountId: id },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
    });

    return items.map(toShippingAddressSummary);
  }

  async getAddress(accountId: string, addressId: string): Promise<ShippingAddressSummary> {
    const acct = normalizeRequiredString(accountId, 'accountId');
    const addr = normalizeRequiredString(addressId, 'addressId');

    await this.assertAccountExists(acct);
    const found = await this.findAddress(acct, addr);
    return toShippingAddressSummary(found);
  }

  async updateAddress(input: UpdateShippingAddressInput): Promise<ShippingAddressSummary> {
    const accountId = normalizeRequiredString(input.accountId, 'accountId');
    const addressId = normalizeRequiredString(input.addressId, 'addressId');

    await this.assertAccountExists(accountId);
    const current = await this.findAddress(accountId, addressId);

    const changes: Record<string, unknown> = {};

    if (input.label !== undefined) {
      changes.label = normalizeRequiredString(input.label, 'label');
    }

    if (input.country !== undefined) {
      changes.country = normalizeRequiredString(input.country, 'country');
    }

    if (input.fullAddress !== undefined) {
      changes.fullAddress = normalizeRequiredString(input.fullAddress, 'fullAddress');
    }

    if (input.isPrimary !== undefined) {
      const isPrimary = normalizeOptionalBoolean(input.isPrimary, 'isPrimary');
      if (isPrimary !== undefined) {
        changes.isPrimary = isPrimary;
      }
    }

    if (input.defaultIncoterm !== undefined) {
      changes.defaultIncoterm =
        input.defaultIncoterm === null ? null : normalizeIncoterm(input.defaultIncoterm);
    }

    if (Object.keys(changes).length === 0) {
      return toShippingAddressSummary(current);
    }

    const updated = await this.repository.$transaction(async (tx) => {
      if (changes.isPrimary === true) {
        await tx.shippingAddress.updateMany({
          where: { accountId, isPrimary: true, NOT: { id: addressId } },
          data: { isPrimary: false },
        });
      }

      return tx.shippingAddress.update({
        where: { id: addressId },
        data: changes,
      });
    });

    await this.actionLogWriter.write({
      actorUserId: normalizeRequiredString(input.actorUserId, 'actorUserId'),
      actionType: 'ACCOUNT_UPDATE',
      targetType: 'ShippingAddress',
      targetId: addressId,
      beforeJson: pickShippingAddressAuditFields(current, Object.keys(changes)),
      afterJson: pickShippingAddressAuditFields(updated, Object.keys(changes)),
      metadataJson: { accountId },
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    return toShippingAddressSummary(updated);
  }

  async deleteAddress(input: DeleteShippingAddressInput): Promise<{ id: string }> {
    const accountId = normalizeRequiredString(input.accountId, 'accountId');
    const addressId = normalizeRequiredString(input.addressId, 'addressId');

    await this.assertAccountExists(accountId);
    const current = await this.findAddress(accountId, addressId);

    await this.repository.shippingAddress.delete({ where: { id: addressId } });

    await this.actionLogWriter.write({
      actorUserId: normalizeRequiredString(input.actorUserId, 'actorUserId'),
      actionType: 'ACCOUNT_UPDATE',
      targetType: 'ShippingAddress',
      targetId: addressId,
      beforeJson: toShippingAddressAuditPayload(current),
      metadataJson: { accountId },
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    return { id: addressId };
  }

  private async assertAccountExists(accountId: string): Promise<void> {
    const account = await this.repository.account.findUnique({ where: { id: accountId } });

    if (!account) {
      throw new DomainRuleError('ACCOUNT_NOT_FOUND', 'Account not found', 404);
    }
  }

  private async findAddress(
    accountId: string,
    addressId: string,
  ): Promise<StoredShippingAddress> {
    const address = await this.repository.shippingAddress.findUnique({
      where: { id: addressId },
    });

    if (!address || address.accountId !== accountId) {
      throw new DomainRuleError(
        'SHIPPING_ADDRESS_NOT_FOUND',
        'Shipping address not found',
        404,
      );
    }

    return address;
  }
}

function normalizeRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new DomainRuleError('VALIDATION_ERROR', `${field} is required`, 400);
  }

  return value.trim();
}

function normalizeOptionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'boolean') {
    throw new DomainRuleError('VALIDATION_ERROR', `${field} must be a boolean`, 400);
  }

  return value;
}

function normalizeIncoterm(value: unknown): Incoterm {
  if (typeof value !== 'string' || !INCOTERMS.includes(value as Incoterm)) {
    throw new DomainRuleError(
      'VALIDATION_ERROR',
      'defaultIncoterm must be EXW, FOB, CIF, DDP, or DAP',
      400,
    );
  }

  return value as Incoterm;
}

function toShippingAddressSummary(address: StoredShippingAddress): ShippingAddressSummary {
  return {
    id: address.id,
    accountId: address.accountId,
    label: address.label,
    country: address.country,
    fullAddress: address.fullAddress,
    isPrimary: address.isPrimary,
    defaultIncoterm: address.defaultIncoterm,
    createdAt: address.createdAt,
    updatedAt: address.updatedAt,
  };
}

function toShippingAddressAuditPayload(address: StoredShippingAddress): Record<string, unknown> {
  return {
    id: address.id,
    accountId: address.accountId,
    label: address.label,
    country: address.country,
    fullAddress: address.fullAddress,
    isPrimary: address.isPrimary,
    defaultIncoterm: address.defaultIncoterm,
  };
}

function pickShippingAddressAuditFields(
  address: StoredShippingAddress,
  fields: string[],
): Record<string, unknown> {
  const payload = toShippingAddressAuditPayload(address);
  const picked: Record<string, unknown> = { id: address.id, accountId: address.accountId };

  for (const field of fields) {
    picked[field] = payload[field];
  }

  return picked;
}
