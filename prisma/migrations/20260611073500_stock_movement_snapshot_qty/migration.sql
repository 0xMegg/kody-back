-- Add nullable stock quantity snapshots to StockMovement ledger rows.
-- Existing historical rows remain compatible with NULL snapshots; service code writes both fields for new INBOUND/ADJUSTMENT movements.
ALTER TABLE "StockMovement"
  ADD COLUMN "previousQty" INTEGER,
  ADD COLUMN "newQty" INTEGER;
