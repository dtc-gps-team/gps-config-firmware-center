-- docs/31 ลองส่งเข้ากล่องใหม่อัตโนมัติ (Rollout ส่งจากหน้างาน · โหมด central)
-- additive ทั้งหมด: คอลัมน์ใหม่มี default / nullable · FK ใหม่อยู่บนคอลัมน์ใหม่
-- (ค่าเริ่มเป็น null) และตารางใหม่ (ยังไม่มีแถว) จึงไม่มีความเสี่ยง orphan บนข้อมูลเดิม

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'config_apply_retrying';

-- AlterTable
ALTER TABLE "CampaignRolloutTarget" ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "nextRetryAt" TIMESTAMP(3),
ADD COLUMN "appliedConfigOverrideId" TEXT;

-- CreateTable
CREATE TABLE "CampaignRolloutTargetAttempt" (
    "id" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "centralCommandId" TEXT,
    "status" TEXT NOT NULL,
    "errorCode" TEXT,
    "detail" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "CampaignRolloutTargetAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CampaignRolloutTarget_nextRetryAt_idx" ON "CampaignRolloutTarget"("nextRetryAt");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignRolloutTargetAttempt_targetId_attemptNo_key" ON "CampaignRolloutTargetAttempt"("targetId", "attemptNo");

-- AddForeignKey
ALTER TABLE "CampaignRolloutTarget" ADD CONSTRAINT "CampaignRolloutTarget_appliedConfigOverrideId_fkey" FOREIGN KEY ("appliedConfigOverrideId") REFERENCES "DeviceConfigOverride"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRolloutTargetAttempt" ADD CONSTRAINT "CampaignRolloutTargetAttempt_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "CampaignRolloutTarget"("id") ON DELETE CASCADE ON UPDATE CASCADE;
