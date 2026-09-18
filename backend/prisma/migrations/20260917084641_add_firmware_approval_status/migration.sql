-- CreateEnum
CREATE TYPE "FirmwareApprovalStatus" AS ENUM ('pending_review', 'approved', 'rejected');

-- AlterTable
ALTER TABLE "Firmware" ADD COLUMN     "approvalStatus" "FirmwareApprovalStatus" NOT NULL DEFAULT 'pending_review',
ADD COLUMN     "approvedBy" TEXT,
ALTER COLUMN "fileSizeBytes" DROP DEFAULT,
ALTER COLUMN "objectKey" DROP DEFAULT,
ALTER COLUMN "originalFilename" DROP DEFAULT;

-- AddForeignKey
ALTER TABLE "Firmware" ADD CONSTRAINT "Firmware_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
