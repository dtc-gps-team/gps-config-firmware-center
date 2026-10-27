-- docs/28 C1 — Task ที่ช่างเริ่มเองจากหน้ากล่อง (additive ล้วน)
-- แถว Task เดิมทั้งหมดเป็น source = 'operation' · completedAt ของงานที่เสร็จไปแล้ว
-- ก่อน migration นี้เป็น NULL (ไม่ย้อนเดาจาก TaskEvent)
-- ConfigApplyRequest.configAssignedBy เป็น nullable: NULL = ช่างเลือก Config เอง
-- (แถวเดิมมีค่าครบทุกแถว ไม่กระทบ)

-- CreateEnum
CREATE TYPE "TaskSource" AS ENUM ('operation', 'technician');

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "autoClosed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "source" "TaskSource" NOT NULL DEFAULT 'operation';

-- AlterTable
ALTER TABLE "ConfigApplyRequest" ALTER COLUMN "configAssignedBy" DROP NOT NULL;

