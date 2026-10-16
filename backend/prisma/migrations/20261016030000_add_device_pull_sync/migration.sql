-- AlterTable
ALTER TABLE "CampaignRollout" ADD COLUMN     "applyMode" TEXT;

-- AlterTable
ALTER TABLE "CampaignRolloutTarget" ADD COLUMN     "pulledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "lastSeenAt" TIMESTAMP(3);
