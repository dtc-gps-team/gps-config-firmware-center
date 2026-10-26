-- docs/25 (PR #364): คำขอส่ง Config เข้าเครื่องจากหน้างาน + ผู้ผูก Config ของ Task — additive ล้วน
-- Task.configAssignedBy ของงานเดิมเป็น null โดยตั้งใจ (ไม่ backfill) — คำขอของงานพวกนี้ถูกปฏิเสธ (fail closed)
-- CreateEnum
CREATE TYPE "ConfigApplyRequestStatus" AS ENUM ('pending', 'sending', 'succeeded', 'failed', 'skipped_offline', 'rejected', 'cancelled', 'expired');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'config_apply_pending';
ALTER TYPE "NotificationType" ADD VALUE 'config_apply_rejected';
ALTER TYPE "NotificationType" ADD VALUE 'config_apply_succeeded';
ALTER TYPE "NotificationType" ADD VALUE 'config_apply_failed';
ALTER TYPE "NotificationType" ADD VALUE 'config_apply_expired';

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "configAssignedAt" TIMESTAMP(3),
ADD COLUMN     "configAssignedBy" TEXT;

-- CreateTable
CREATE TABLE "ConfigApplyRequest" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "configAssignedBy" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "status" "ConfigApplyRequestStatus" NOT NULL DEFAULT 'pending',
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "rolloutId" TEXT,
    "resultDetail" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConfigApplyRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConfigApplyRequest_rolloutId_key" ON "ConfigApplyRequest"("rolloutId");

-- CreateIndex
CREATE INDEX "ConfigApplyRequest_deviceId_status_idx" ON "ConfigApplyRequest"("deviceId", "status");

-- CreateIndex
CREATE INDEX "ConfigApplyRequest_taskId_idx" ON "ConfigApplyRequest"("taskId");

-- CreateIndex
CREATE INDEX "ConfigApplyRequest_status_expiresAt_idx" ON "ConfigApplyRequest"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_configAssignedBy_fkey" FOREIGN KEY ("configAssignedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfigApplyRequest" ADD CONSTRAINT "ConfigApplyRequest_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfigApplyRequest" ADD CONSTRAINT "ConfigApplyRequest_configId_fkey" FOREIGN KEY ("configId") REFERENCES "Config"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfigApplyRequest" ADD CONSTRAINT "ConfigApplyRequest_requestedBy_fkey" FOREIGN KEY ("requestedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfigApplyRequest" ADD CONSTRAINT "ConfigApplyRequest_configAssignedBy_fkey" FOREIGN KEY ("configAssignedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfigApplyRequest" ADD CONSTRAINT "ConfigApplyRequest_decidedBy_fkey" FOREIGN KEY ("decidedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfigApplyRequest" ADD CONSTRAINT "ConfigApplyRequest_rolloutId_fkey" FOREIGN KEY ("rolloutId") REFERENCES "CampaignRollout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

