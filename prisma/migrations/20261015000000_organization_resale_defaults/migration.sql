-- AlterTable
ALTER TABLE "Organization"
ADD COLUMN "defaultMaxResaleMultiplierBps" INTEGER NOT NULL DEFAULT 11000,
ADD COLUMN "defaultRoyaltyBps" INTEGER NOT NULL DEFAULT 500;
