// ---------------------------------------------------------------------------
// Domain enum types — string literal unions mirroring Prisma schema enums.
// Domain layer must NOT import from @prisma/client.
// ---------------------------------------------------------------------------

export type Currency = 'KRW' | 'USD' | 'EUR' | 'RUB';

export type OrderStatus = 'PENDING' | 'CONFIRMED' | 'SUSPENDED';

export type ShipmentStatus = 'PENDING' | 'COMPLETED';

export type ShipmentItemStatus = 'NOT_SHIPPED' | 'PENDING' | 'COMPLETED';

export type ProductCategory = 'ALBUM' | 'PHOTOCARD' | 'GOODS';

export type Incoterm = 'EXW' | 'FOB' | 'CIF' | 'DDP' | 'DAP';

export type DepositSource = 'NONGHYUP' | 'HANA' | 'PAYPAL' | 'PAYONEER';

export type PaymentType = 'DEPOSIT' | 'WITHDRAWAL' | 'ADJUSTMENT';

export type StockMovementType = 'INBOUND' | 'OUTBOUND' | 'ADJUSTMENT';

export type EmployeeStatus = 'ACTIVE' | 'INACTIVE';

export type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'INACTIVE';

export type Role = 'ADMIN' | 'SALES' | 'OPERATIONS' | 'WAREHOUSE' | 'FINANCE';

export type ActionType =
  | 'INVENTORY_ADJUST'
  | 'INVENTORY_INBOUND'
  | 'ORDER_CREATE'
  | 'ORDER_CONFIRM'
  | 'ORDER_CANCEL'
  | 'SHIPMENT_PICK'
  | 'SHIPMENT_PACK'
  | 'SHIPMENT_COMPLETE'
  | 'PAYMENT_CREATE'
  | 'ACCOUNT_CREATE'
  | 'ACCOUNT_UPDATE'
  | 'USER_LOGIN'
  | 'USER_LOGOUT'
  | 'USER_ROLE_CHANGE'
  | 'USER_STATUS_CHANGE';

// ---------------------------------------------------------------------------
// Pagination & sorting
// ---------------------------------------------------------------------------

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export type SortDirection = 'asc' | 'desc';
