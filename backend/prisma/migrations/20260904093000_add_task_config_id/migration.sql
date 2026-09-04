-- Task.configId: Config ที่ Operation ผูกกับงานตอนสร้าง Task ประเภทติดตั้ง
-- (option a ตกลงกับ A ใน PR #81) — Mobile อ่านไปส่งเข้า apply-config ตอนทำจอ
-- "Confirm Install" (#26 Sprint 3)
--
-- Additive + nullable — ทุก Task ที่มีอยู่เดิมได้ configId = NULL ไม่มี orphan
-- FK เป็นไปไม่ได้ (ไม่มีค่าให้ชี้ผิด) จึงไม่ต้อง backfill / เช็ค orphan data
-- ON DELETE SET NULL — สอดคล้องกับ Campaign_configId_fkey / Incident_relatedConfigId_fkey
-- (nullable Config FK ตัวอื่น)
--
-- migration นี้แตะแค่ตาราง Task — ไม่แตะ Device จึงไม่กระทบ partial unique
-- index "Device_simNumber_active_key" (ดูคำเตือน Prisma migrate diff ใน schema.prisma)

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "configId" TEXT;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_configId_fkey" FOREIGN KEY ("configId") REFERENCES "Config"("id") ON DELETE SET NULL ON UPDATE CASCADE;
