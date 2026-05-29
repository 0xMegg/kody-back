-- Add a separate login ID while preserving existing accounts.
ALTER TABLE "User" ADD COLUMN "loginId" TEXT;

-- Existing accounts can still log in with their email until an admin/backfill changes it.
UPDATE "User" SET "loginId" = lower("email") WHERE "loginId" IS NULL;

ALTER TABLE "User" ALTER COLUMN "loginId" SET NOT NULL;
CREATE UNIQUE INDEX "User_loginId_key" ON "User"("loginId");
