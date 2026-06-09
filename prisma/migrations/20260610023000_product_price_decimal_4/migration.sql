-- Preserve Imweb KR calculated sales prices up to 4 fractional digits.
ALTER TABLE "Product"
  ALTER COLUMN "priceKRW" TYPE DECIMAL(15,4)
  USING "priceKRW"::DECIMAL(15,4);
