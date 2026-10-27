-- CreateEnum
CREATE TYPE "FieldApplyKind" AS ENUM ('config', 'firmware');

-- AlterTable
ALTER TABLE "ConfigApplyRequest" ADD COLUMN     "firmwareId" TEXT,
ADD COLUMN     "fromFirmwareVersion" TEXT,
ADD COLUMN     "isDowngrade" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "kind" "FieldApplyKind" NOT NULL DEFAULT 'config',
ALTER COLUMN "configId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "CampaignRollout" ADD COLUMN     "allowDowngrade" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "ConfigApplyRequest" ADD CONSTRAINT "ConfigApplyRequest_firmwareId_fkey" FOREIGN KEY ("firmwareId") REFERENCES "Firmware"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

