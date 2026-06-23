-- Phase 2A-G4c-1: additive product taxonomy contract.
-- Offline incremental SQL only; no data backfill and no PHOTOCARD migration.

ALTER TYPE "ProductCategory" ADD VALUE IF NOT EXISTS 'MAGAZINE';
ALTER TYPE "ProductCategory" ADD VALUE IF NOT EXISTS 'SEASON_GREETINGS';

CREATE TYPE "ProductCategoryMinor" AS ENUM (
  'BOY_GROUP',
  'GIRL_GROUP',
  'SOLO',
  'JAPANESE_ALBUM',
  'OST',
  'OFFICIAL_GOODS',
  'FANDOM_GOODS'
);

CREATE TYPE "ProductItemType" AS ENUM (
  'LIGHT_STICK',
  'MD',
  'PHOTOBOOK',
  'PHOTO_CARD',
  'MUSIC_SHEET',
  'SANRIO',
  'HOLDER',
  'COLLECT_BOOK',
  'STICKER'
);

ALTER TABLE "Product" ADD COLUMN "categoryMinor" "ProductCategoryMinor";
ALTER TABLE "Product" ADD COLUMN "itemType" "ProductItemType";

CREATE INDEX "Product_categoryMinor_idx" ON "Product"("categoryMinor");
CREATE INDEX "Product_itemType_idx" ON "Product"("itemType");
