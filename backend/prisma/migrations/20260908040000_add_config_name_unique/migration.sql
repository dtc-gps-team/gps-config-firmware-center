-- Config.name: ชื่อ Config ที่ unique ทั้งระบบ (มติ Sprint 1 review ข้อ 4 / #26 —
-- ดู docs/09_Sprint1_Review_Decisions.md §2) กัน SW สร้าง/แก้ config ชนกันเอง
-- หรือมี config ซ้ำที่แยกไม่ออกว่าอันไหนของจริง
--
-- ตาราง Config อาจมีข้อมูลอยู่แล้วใน environment ที่รันมาก่อน — ADD COLUMN NOT NULL
-- ตรงๆ จะ fail จึงทำ 3 สเต็ป:
--   (1) เพิ่มคอลัมน์แบบ nullable ก่อน
--   (2) backfill ให้ทุกแถวเดิมด้วยค่าที่ unique แน่นอน (ใช้ id ซึ่งเป็น PK เป็น
--       ส่วนหนึ่งของชื่อ — เป็นไปไม่ได้ที่จะซ้ำ)
--   (3) บังคับ NOT NULL + สร้าง unique index
-- แถวใหม่หลังจากนี้ต้องส่ง name มาเองเสมอ (CreateConfigDto บังคับ required)

-- AlterTable — (1) nullable ก่อน
ALTER TABLE "Config" ADD COLUMN "name" TEXT;

-- (2) backfill แถวเดิม
UPDATE "Config"
SET "name" = 'Config ' || "deviceModel" || '/' || "protocol" || ' ' || "id"
WHERE "name" IS NULL;

-- (3) บังคับ NOT NULL + unique
ALTER TABLE "Config" ALTER COLUMN "name" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Config_name_key" ON "Config"("name");
