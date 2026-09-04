-- ConfigVersion.versionNumber: running number ต่อ config (Phase 1 ข้อ 9 / #26)
-- ADD COLUMN ... NOT NULL ปลอดภัย — ตาราง ConfigVersion ว่างทุก environment
-- (ยังไม่มีโค้ดเขียนลงตารางนี้ก่อน migration นี้) จึงไม่ต้อง backfill / default
-- AlterTable
ALTER TABLE "ConfigVersion" ADD COLUMN     "versionNumber" INTEGER NOT NULL;

-- CreateIndex
CREATE INDEX "ConfigVersion_configId_idx" ON "ConfigVersion"("configId");

-- CreateIndex
CREATE UNIQUE INDEX "ConfigVersion_configId_versionNumber_key" ON "ConfigVersion"("configId", "versionNumber");
