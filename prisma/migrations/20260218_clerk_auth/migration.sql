-- Migration: Replace access code auth with Clerk auth
-- Add clerkId column (nullable for transition period)
ALTER TABLE "users" ADD COLUMN "clerkId" TEXT;
CREATE UNIQUE INDEX "users_clerkId_key" ON "users"("clerkId");

-- Add email column
ALTER TABLE "users" ADD COLUMN "email" TEXT;

-- Add role column with default
ALTER TABLE "users" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'user';

-- Drop old access code columns
-- Note: Drop the unique index on code first, then the column
DROP INDEX IF EXISTS "users_code_key";
ALTER TABLE "users" DROP COLUMN IF EXISTS "code";
ALTER TABLE "users" DROP COLUMN IF EXISTS "expiryDate";
