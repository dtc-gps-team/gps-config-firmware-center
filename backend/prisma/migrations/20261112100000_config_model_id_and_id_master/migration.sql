-- Config ผูกกับรุ่นอุปกรณ์ด้วย id (FK ไป DeviceModel) แทนชื่อรุ่น และเพิ่มรหัสกลาง id_master
-- (B, 12 พ.ย. 2569)
--
-- **ไม่ใช่ additive ล้วน:** ลบคอลัมน์ "Config"."deviceModel" หลังย้ายค่าไป "modelId" ครบแล้ว
-- (ข้อยกเว้นกฎ migration additive ใน CLAUDE.md — ตกลงกับ A ใน PR) · ชื่อรุ่นอ่านจาก
-- "DeviceModel"."name" ผ่าน relation แทน

-- 0. ตรวจก่อนแก้อะไรทั้งนั้น: Config ทุกแถวต้องจับคู่ชื่อรุ่นกับ DeviceModel ได้
--    เจอแถวที่จับคู่ไม่ได้ = หยุดทันที ฐานข้อมูลยังไม่ถูกแก้ (Migration Safety ใน CLAUDE.md —
--    ห้ามบังคับผ่านหรือลบข้อมูล) · แก้โดยสร้างรุ่นที่ขาดใน Device Model Registry แล้วรันใหม่
DO $$
DECLARE
  missing TEXT;
BEGIN
  SELECT string_agg(DISTINCT c."deviceModel", ', ')
    INTO missing
    FROM "Config" c
    LEFT JOIN "DeviceModel" m ON m."name" = c."deviceModel"
   WHERE m."id" IS NULL;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Config อ้างชื่อรุ่นที่ไม่มีในตาราง DeviceModel: % (สร้างรุ่นเหล่านี้ก่อน แล้วรัน migration ใหม่)', missing;
  END IF;
END $$;

-- 1. id_master: UUID ที่ฐานข้อมูลสร้างให้เอง (Config เดิมได้ค่าคนละตัวทันที เพราะ default ถูกเรียกทีละแถว)
ALTER TABLE "Config" ADD COLUMN "id_master" TEXT NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX "Config_id_master_key" ON "Config"("id_master");

-- 2. modelId: เพิ่มแบบว่างได้ก่อน -> เติมจากชื่อรุ่น -> บังคับ NOT NULL + FK
ALTER TABLE "Config" ADD COLUMN "modelId" TEXT;

UPDATE "Config" c
   SET "modelId" = m."id"
  FROM "DeviceModel" m
 WHERE m."name" = c."deviceModel";

ALTER TABLE "Config" ALTER COLUMN "modelId" SET NOT NULL;

CREATE INDEX "Config_modelId_idx" ON "Config"("modelId");

ALTER TABLE "Config" ADD CONSTRAINT "Config_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "DeviceModel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3. ลบชื่อรุ่นที่เก็บซ้ำ (ค่าย้ายไป modelId ครบแล้วในข้อ 2)
ALTER TABLE "Config" DROP COLUMN "deviceModel";
