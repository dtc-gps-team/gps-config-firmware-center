-- CreateEnum
CREATE TYPE "DevicePartitionSlot" AS ENUM ('A', 'B');

-- AlterEnum
ALTER TYPE "CampaignRolloutStatus" ADD VALUE 'paused';

-- AlterTable
ALTER TABLE "CampaignRollout" ADD COLUMN     "isRollback" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rollbackOfId" TEXT;

-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "activePartition" "DevicePartitionSlot" NOT NULL DEFAULT 'A',
ADD COLUMN     "partitionAFirmwareId" TEXT,
ADD COLUMN     "partitionBFirmwareId" TEXT;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_partitionAFirmwareId_fkey" FOREIGN KEY ("partitionAFirmwareId") REFERENCES "Firmware"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_partitionBFirmwareId_fkey" FOREIGN KEY ("partitionBFirmwareId") REFERENCES "Firmware"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRollout" ADD CONSTRAINT "CampaignRollout_rollbackOfId_fkey" FOREIGN KEY ("rollbackOfId") REFERENCES "CampaignRollout"("id") ON DELETE SET NULL ON UPDATE CASCADE;
