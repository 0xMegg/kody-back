-- CreateEnum
CREATE TYPE "DisplayLifecycleState" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CalendarSourceType" AS ENUM ('PRODUCT_SALE_WINDOW');

-- CreateEnum
CREATE TYPE "CalendarProjectionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CANCELLED');

-- CreateTable
CREATE TABLE "DisplayCollection" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "lifecycleState" "DisplayLifecycleState" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,

    CONSTRAINT "DisplayCollection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisplayCollectionProduct" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sortPosition" INTEGER NOT NULL DEFAULT 0,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DisplayCollectionProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HomepageLayout" (
    "id" TEXT NOT NULL,
    "state" "DisplayLifecycleState" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL,
    "snapshotHash" TEXT,
    "publishedAt" TIMESTAMP(3),
    "publishedByUserId" TEXT,
    "previousPublishedLayoutId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomepageLayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HomepageLayoutCollection" (
    "id" TEXT NOT NULL,
    "layoutId" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "sortPosition" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomepageLayoutCollection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarEventProjection" (
    "id" TEXT NOT NULL,
    "sourceType" "CalendarSourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "startsAtUtc" TIMESTAMP(3),
    "endsAtUtc" TIMESTAMP(3),
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Seoul',
    "status" "CalendarProjectionStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarEventProjection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DisplayCollection_lifecycleState_idx" ON "DisplayCollection"("lifecycleState");

-- CreateIndex
CREATE INDEX "DisplayCollection_createdAt_idx" ON "DisplayCollection"("createdAt");

-- CreateIndex
CREATE INDEX "DisplayCollectionProduct_collectionId_sortPosition_idx" ON "DisplayCollectionProduct"("collectionId", "sortPosition");

-- CreateIndex
CREATE INDEX "DisplayCollectionProduct_productId_idx" ON "DisplayCollectionProduct"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "DisplayCollectionProduct_collectionId_productId_key" ON "DisplayCollectionProduct"("collectionId", "productId");

-- CreateIndex
CREATE INDEX "HomepageLayout_state_idx" ON "HomepageLayout"("state");

-- CreateIndex
CREATE INDEX "HomepageLayoutCollection_layoutId_sortPosition_idx" ON "HomepageLayoutCollection"("layoutId", "sortPosition");

-- CreateIndex
CREATE INDEX "HomepageLayoutCollection_collectionId_idx" ON "HomepageLayoutCollection"("collectionId");

-- CreateIndex
CREATE UNIQUE INDEX "HomepageLayoutCollection_layoutId_collectionId_key" ON "HomepageLayoutCollection"("layoutId", "collectionId");

-- CreateIndex
CREATE INDEX "CalendarEventProjection_status_idx" ON "CalendarEventProjection"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEventProjection_sourceType_sourceId_key" ON "CalendarEventProjection"("sourceType", "sourceId");

-- AddForeignKey
ALTER TABLE "DisplayCollectionProduct" ADD CONSTRAINT "DisplayCollectionProduct_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "DisplayCollection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisplayCollectionProduct" ADD CONSTRAINT "DisplayCollectionProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomepageLayoutCollection" ADD CONSTRAINT "HomepageLayoutCollection_layoutId_fkey" FOREIGN KEY ("layoutId") REFERENCES "HomepageLayout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomepageLayoutCollection" ADD CONSTRAINT "HomepageLayoutCollection_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "DisplayCollection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
