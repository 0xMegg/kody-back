import { DomainRuleError } from '@/domain/shared/errors.js';
import type { Incoterm, ShipmentStatus } from '@/domain/shared/types.js';
import type { ActionLogWriter } from '@/application/shared/action-log-writer.js';

export interface AllocateShipmentInput {
  actorUserId: string;
  shipmentId: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface ShipmentItemSummary {
  id: string;
  shipmentId: string;
  orderItemId: string;
  productId: string;
  quantity: number;
  subtotal: string;
  stockMovementId: string | null;
}

export interface ShipmentSummary {
  id: string;
  orderId: string | null;
  accountId: string;
  shippingAddressId: string;
  shipDate: Date | null;
  incoterm: Incoterm;
  trackingNumber: string | null;
  status: ShipmentStatus;
  createdAt: Date;
  updatedAt: Date;
  items: ShipmentItemSummary[];
}

interface DecimalLike {
  toString(): string;
}

interface StoredOrderItemLite {
  id: string;
  orderId: string;
  shipmentStatus: 'NOT_SHIPPED' | 'PENDING' | 'COMPLETED';
}

interface StoredShipmentItem {
  id: string;
  shipmentId: string;
  orderItemId: string;
  productId: string;
  quantity: number;
  subtotal: DecimalLike;
  orderItem?: StoredOrderItemLite;
  stockMovements?: Array<{ id: string }>;
}

interface StoredShipment {
  id: string;
  orderId: string | null;
  accountId: string;
  shippingAddressId: string;
  shipDate: Date | null;
  incoterm: Incoterm;
  trackingNumber: string | null;
  status: ShipmentStatus;
  createdAt: Date;
  updatedAt: Date;
  items?: StoredShipmentItem[];
}

interface StoredProductStock {
  id: string;
  stockOnHand: number;
  shipmentBasedStock: number;
}

interface ShipmentRepository {
  $transaction<T>(callback: (tx: ShipmentRepository) => Promise<T>): Promise<T>;
  $executeRawUnsafe?(query: string, ...values: unknown[]): Promise<unknown>;
  shipment: {
    findUnique(args: {
      where: { id: string };
      include?: { items: { include: { orderItem: boolean; stockMovements?: boolean } } };
    }): Promise<StoredShipment | null>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
      include?: { items: { include: { orderItem: boolean; stockMovements?: boolean } } };
    }): Promise<StoredShipment>;
  };
  product: {
    findUnique(args: { where: { id: string } }): Promise<StoredProductStock | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<StoredProductStock>;
  };
  orderItem: {
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
  stockMovement: {
    create(args: { data: Record<string, unknown> }): Promise<{ id: string }>;
  };
  shipmentEvent: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
}

export class ShipmentService {
  constructor(
    private readonly repository: ShipmentRepository,
    private readonly actionLogWriter: ActionLogWriter,
  ) {}

  async allocateShipment(input: AllocateShipmentInput): Promise<ShipmentSummary> {
    const shipmentId = normalizeRequiredString(input.shipmentId, 'shipmentId');

    const result = await this.repository.$transaction(async (tx) => {
      const shipment = await findShipment(tx, shipmentId);
      const items = shipment.items ?? [];
      if (items.length === 0) {
        throw new DomainRuleError('SHIPMENT_EMPTY', 'Shipment must contain at least one item', 400);
      }

      const orderIds = new Set(items.map((item) => item.orderItem?.orderId).filter((orderId): orderId is string => Boolean(orderId)));
      if (orderIds.size !== 1) {
        throw new DomainRuleError('SHIPMENT_ORDER_INVARIANT', 'Shipment items must belong to exactly one order', 400);
      }
      const [orderId] = Array.from(orderIds);
      if (shipment.orderId !== null && shipment.orderId !== orderId) {
        throw new DomainRuleError('SHIPMENT_ORDER_INVARIANT', 'Shipment orderId conflicts with its items', 400);
      }

      const alreadyAllocated = items.every((item) => item.orderItem?.shipmentStatus !== 'NOT_SHIPPED');
      if (alreadyAllocated) {
        const persisted = shipment.orderId === orderId ? shipment : await updateShipmentOrder(tx, shipment.id, orderId);
        return { shipment: persisted, allocated: false };
      }

      for (const item of items) {
        if (!item.orderItem) {
          throw new DomainRuleError('ORDER_ITEM_NOT_FOUND', 'Shipment item is missing its order item', 400);
        }
        if (item.orderItem.shipmentStatus !== 'NOT_SHIPPED') {
          continue;
        }

        await lockProduct(tx, item.productId);
        const current = await tx.product.findUnique({ where: { id: item.productId } });
        if (!current) {
          throw new DomainRuleError('PRODUCT_NOT_FOUND', 'Product not found', 404);
        }
        if (current.stockOnHand < item.quantity) {
          throw new DomainRuleError('INSUFFICIENT_STOCK', 'Insufficient stock for shipment allocation', 400);
        }
        const previousQty = current.stockOnHand;
        const newQty = previousQty - item.quantity;

        await tx.product.update({
          where: { id: item.productId },
          data: {
            stockOnHand: { decrement: item.quantity },
            shipmentBasedStock: { decrement: item.quantity },
          },
        });
        await tx.orderItem.update({ where: { id: item.orderItemId }, data: { shipmentStatus: 'PENDING' } });
        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            shipmentItemId: item.id,
            type: 'OUTBOUND',
            quantity: -item.quantity,
            previousQty,
            newQty,
            reason: `Shipment allocation ${shipment.id}`,
            createdById: input.actorUserId,
          },
        });
      }

      await tx.shipmentEvent.create({
        data: {
          shipmentId: shipment.id,
          eventType: 'ALLOCATED',
          actorUserId: input.actorUserId,
          metadataJson: { orderId, itemCount: items.length },
        },
      });

      const persisted = await updateShipmentOrder(tx, shipment.id, orderId);
      return { shipment: persisted, allocated: true };
    });

    if (result.allocated) {
      await this.actionLogWriter.write({
        actorUserId: input.actorUserId,
        actionType: 'SHIPMENT_PICK',
        targetType: 'Shipment',
        targetId: result.shipment.id,
        afterJson: {
          shipmentId: result.shipment.id,
          orderId: result.shipment.orderId,
          itemCount: (result.shipment.items ?? []).length,
        },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      });
    }

    return toShipmentSummary(result.shipment);
  }
}

async function findShipment(repository: ShipmentRepository, shipmentId: string): Promise<StoredShipment> {
  const shipment = await repository.shipment.findUnique({
    where: { id: shipmentId },
    include: { items: { include: { orderItem: true, stockMovements: true } } },
  });
  if (!shipment) {
    throw new DomainRuleError('SHIPMENT_NOT_FOUND', 'Shipment not found', 404);
  }
  return shipment;
}

async function updateShipmentOrder(repository: ShipmentRepository, shipmentId: string, orderId: string): Promise<StoredShipment> {
  return repository.shipment.update({
    where: { id: shipmentId },
    data: { orderId },
    include: { items: { include: { orderItem: true, stockMovements: true } } },
  });
}

async function lockProduct(repository: ShipmentRepository, productId: string): Promise<void> {
  if (repository.$executeRawUnsafe) {
    await repository.$executeRawUnsafe('SELECT id FROM "Product" WHERE id = $1 FOR UPDATE', productId);
  }
}

function toShipmentSummary(shipment: StoredShipment): ShipmentSummary {
  return {
    id: shipment.id,
    orderId: shipment.orderId,
    accountId: shipment.accountId,
    shippingAddressId: shipment.shippingAddressId,
    shipDate: shipment.shipDate,
    incoterm: shipment.incoterm,
    trackingNumber: shipment.trackingNumber,
    status: shipment.status,
    createdAt: shipment.createdAt,
    updatedAt: shipment.updatedAt,
    items: (shipment.items ?? []).map((item) => ({
      id: item.id,
      shipmentId: item.shipmentId,
      orderItemId: item.orderItemId,
      productId: item.productId,
      quantity: item.quantity,
      subtotal: item.subtotal.toString(),
      stockMovementId: item.stockMovements?.[0]?.id ?? null,
    })),
  };
}

function normalizeRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new DomainRuleError('VALIDATION_ERROR', `${field} is required`, 400);
  }
  return value.trim();
}
