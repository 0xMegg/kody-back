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

export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE';

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
