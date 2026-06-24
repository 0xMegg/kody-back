-- CreateEnum
CREATE TYPE "ProductPublicSaleWindowStatus" AS ENUM ('DRAFT', 'APPROVED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Product"
ADD COLUMN "publicSaleStartsAt" TIMESTAMP(3),
ADD COLUMN "publicSaleEndsAt" TIMESTAMP(3),
ADD COLUMN "publicSaleWindowStatus" "ProductPublicSaleWindowStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN "publicSaleWindowUpdatedByUserId" TEXT,
ADD COLUMN "publicSaleWindowUpdatedAt" TIMESTAMP(3);
