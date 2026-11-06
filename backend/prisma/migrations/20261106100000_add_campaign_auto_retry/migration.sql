-- ลองส่งใหม่อัตโนมัติต่อ Campaign (docs/31 §6, C5): Campaign ที่มีอยู่แล้วเป็น false (ไม่เปลี่ยนสิ่งที่ Operation
-- เคยอนุมัติไว้ตอนที่ระบบยังไม่มีการส่งซ้ำ) ส่วน Campaign ที่สร้างหลังจากนี้เป็น true ตาม default ของคอลัมน์
ALTER TABLE "Campaign" ADD COLUMN "autoRetry" BOOLEAN NOT NULL DEFAULT true;
UPDATE "Campaign" SET "autoRetry" = false;
