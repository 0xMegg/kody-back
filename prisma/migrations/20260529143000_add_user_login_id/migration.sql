-- Add a separate login ID while preserving existing accounts.
ALTER TABLE "User" ADD COLUMN "loginId" TEXT;

-- Existing accounts receive lower(email) as their initial loginId.
UPDATE "User" SET "loginId" = lower("email") WHERE "loginId" IS NULL;

ALTER TABLE "User" ALTER COLUMN "loginId" SET NOT NULL;
CREATE UNIQUE INDEX "User_loginId_key" ON "User"("loginId");
