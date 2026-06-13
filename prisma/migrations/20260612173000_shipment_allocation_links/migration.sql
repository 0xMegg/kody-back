-- Add shipment allocation audit/event links without applying to any environment.
ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "orderId" TEXT;
ALTER TABLE "StockMovement" ADD COLUMN IF NOT EXISTS "shipmentItemId" TEXT;

CREATE TABLE IF NOT EXISTS "ShipmentEvent" (
  "id" TEXT NOT NULL,
  "shipmentId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "actorUserId" TEXT,
  "metadataJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShipmentEvent_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Shipment_orderId_fkey'
  ) THEN
    ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_orderId_fkey"
      FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'StockMovement_shipmentItemId_fkey'
  ) THEN
    ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_shipmentItemId_fkey"
      FOREIGN KEY ("shipmentItemId") REFERENCES "ShipmentItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ShipmentEvent_shipmentId_fkey'
  ) THEN
    ALTER TABLE "ShipmentEvent" ADD CONSTRAINT "ShipmentEvent_shipmentId_fkey"
      FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ShipmentEvent_actorUserId_fkey'
  ) THEN
    ALTER TABLE "ShipmentEvent" ADD CONSTRAINT "ShipmentEvent_actorUserId_fkey"
      FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Shipment_orderId_idx" ON "Shipment"("orderId");
CREATE INDEX IF NOT EXISTS "StockMovement_shipmentItemId_idx" ON "StockMovement"("shipmentItemId");
CREATE INDEX IF NOT EXISTS "ShipmentEvent_shipmentId_idx" ON "ShipmentEvent"("shipmentId");
CREATE INDEX IF NOT EXISTS "ShipmentEvent_eventType_idx" ON "ShipmentEvent"("eventType");
CREATE INDEX IF NOT EXISTS "ShipmentEvent_createdAt_idx" ON "ShipmentEvent"("createdAt");
