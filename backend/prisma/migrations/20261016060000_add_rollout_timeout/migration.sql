-- AlterEnum
ALTER TYPE "CampaignRolloutTargetStatus" ADD VALUE 'skipped_offline';

-- AlterTable
ALTER TABLE "CampaignRollout" ADD COLUMN     "applyTimeoutMinutes" INTEGER,
ADD COLUMN     "pullTimeoutHours" INTEGER;
