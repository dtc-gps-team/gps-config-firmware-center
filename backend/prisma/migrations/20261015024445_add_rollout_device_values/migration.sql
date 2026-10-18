-- AlterTable
ALTER TABLE "CampaignRollout" ADD COLUMN     "deviceValuesReason" TEXT;

-- AlterTable
ALTER TABLE "CampaignRolloutTarget" ADD COLUMN     "proposedFields" JSONB;
