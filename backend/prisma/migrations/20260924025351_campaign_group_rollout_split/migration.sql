/*
  Warnings:

  - You are about to drop the column `approvedAt` on the `Campaign` table. All the data in the column will be lost.
  - You are about to drop the column `approvedBy` on the `Campaign` table. All the data in the column will be lost.
  - You are about to drop the column `configId` on the `Campaign` table. All the data in the column will be lost.
  - You are about to drop the column `failureCount` on the `Campaign` table. All the data in the column will be lost.
  - You are about to drop the column `firmwareId` on the `Campaign` table. All the data in the column will be lost.
  - You are about to drop the column `payloadType` on the `Campaign` table. All the data in the column will be lost.
  - You are about to drop the column `status` on the `Campaign` table. All the data in the column will be lost.
  - You are about to drop the column `successCount` on the `Campaign` table. All the data in the column will be lost.
  - You are about to drop the column `targetCount` on the `Campaign` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "CampaignRolloutStatus" AS ENUM ('pending_approval', 'active', 'rejected', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "CampaignRolloutTargetStatus" AS ENUM ('pending', 'success', 'failed');

-- DropForeignKey
ALTER TABLE "Campaign" DROP CONSTRAINT "Campaign_approvedBy_fkey";

-- DropForeignKey
ALTER TABLE "Campaign" DROP CONSTRAINT "Campaign_configId_fkey";

-- DropForeignKey
ALTER TABLE "Campaign" DROP CONSTRAINT "Campaign_firmwareId_fkey";

-- AlterTable
ALTER TABLE "Campaign" DROP COLUMN "approvedAt",
DROP COLUMN "approvedBy",
DROP COLUMN "configId",
DROP COLUMN "failureCount",
DROP COLUMN "firmwareId",
DROP COLUMN "payloadType",
DROP COLUMN "status",
DROP COLUMN "successCount",
DROP COLUMN "targetCount";

-- DropEnum
DROP TYPE "CampaignStatus";

-- CreateTable
CREATE TABLE "CampaignRollout" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "payloadType" "CampaignPayloadType" NOT NULL,
    "configId" TEXT,
    "firmwareId" TEXT,
    "status" "CampaignRolloutStatus" NOT NULL DEFAULT 'pending_approval',
    "targetCount" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignRollout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignRolloutTarget" (
    "id" TEXT NOT NULL,
    "rolloutId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "status" "CampaignRolloutTargetStatus" NOT NULL DEFAULT 'pending',
    "resultDetail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignRolloutTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CampaignRolloutTarget_rolloutId_idx" ON "CampaignRolloutTarget"("rolloutId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignRolloutTarget_rolloutId_deviceId_key" ON "CampaignRolloutTarget"("rolloutId", "deviceId");

-- AddForeignKey
ALTER TABLE "CampaignRollout" ADD CONSTRAINT "CampaignRollout_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRollout" ADD CONSTRAINT "CampaignRollout_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRollout" ADD CONSTRAINT "CampaignRollout_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRollout" ADD CONSTRAINT "CampaignRollout_configId_fkey" FOREIGN KEY ("configId") REFERENCES "Config"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRollout" ADD CONSTRAINT "CampaignRollout_firmwareId_fkey" FOREIGN KEY ("firmwareId") REFERENCES "Firmware"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRolloutTarget" ADD CONSTRAINT "CampaignRolloutTarget_rolloutId_fkey" FOREIGN KEY ("rolloutId") REFERENCES "CampaignRollout"("id") ON DELETE CASCADE ON UPDATE CASCADE;
