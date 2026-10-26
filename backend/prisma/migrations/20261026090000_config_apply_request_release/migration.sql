-- docs/27 (B1) — อนุมัติแล้วรอช่างกดส่ง: สถานะ approved, ผู้กดส่ง/เวลา, เวอร์ชัน Config ที่อนุมัติ
-- และ notification config_apply_approved · additive ล้วน ไม่แตะแถวเดิม

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'config_apply_approved';

-- AlterEnum
ALTER TYPE "ConfigApplyRequestStatus" ADD VALUE 'approved';

-- AlterTable
ALTER TABLE "ConfigApplyRequest" ADD COLUMN     "approvedConfigVersion" INTEGER,
ADD COLUMN     "releasedAt" TIMESTAMP(3),
ADD COLUMN     "releasedBy" TEXT;

-- AddForeignKey
ALTER TABLE "ConfigApplyRequest" ADD CONSTRAINT "ConfigApplyRequest_releasedBy_fkey" FOREIGN KEY ("releasedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

