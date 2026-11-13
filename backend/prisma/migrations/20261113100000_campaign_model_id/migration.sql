-- Campaign ผูกกับรุ่นอุปกรณ์ได้รุ่นเดียว (A, 13 พ.ย. 2569) — additive
--
-- เพิ่ม "Campaign"."modelId" แบบว่างได้ (FK ไป DeviceModel) · Campaign ใหม่ต้องระบุรุ่น (บังคับที่
-- CampaignService) ส่วน Campaign เดิมเก็บไว้ทั้งหมด ไม่ลบไม่แก้ข้อมูลเดิม:
--   - กลุ่มที่สมาชิกทุกเครื่องเป็นรุ่นเดียวกัน -> เติมรุ่นนั้นให้ (ใช้แบบใหม่ได้ทันที)
--   - กลุ่มที่มีหลายรุ่นปนกัน / ไม่มีสมาชิก / Campaign ระบบของคำขอหน้างาน -> ว่างไว้ ทำงานแบบเดิม

-- 1. คอลัมน์ใหม่ + index + FK (ON DELETE RESTRICT ตาม Config.modelId)
ALTER TABLE "Campaign" ADD COLUMN "modelId" TEXT;

CREATE INDEX "Campaign_modelId_idx" ON "Campaign"("modelId");

ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "DeviceModel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2. เติมรุ่นให้กลุ่มเดิมที่มีรุ่นเดียว (CampaignTarget.deviceId คือ Device.deviceId ไม่ใช่ Device.id)
--    ยกเว้น Campaign ระบบของคำขอหน้างาน (ชื่อตรงกับ FIELD_APPLY_SYSTEM_CAMPAIGN_NAME) ที่ต้องรับได้ทุกรุ่น
UPDATE "Campaign" c
   SET "modelId" = single."modelId"
  FROM (
    SELECT t."campaignId", MIN(d."modelId") AS "modelId"
      FROM "CampaignTarget" t
      JOIN "Device" d ON d."deviceId" = t."deviceId"
     GROUP BY t."campaignId"
    HAVING COUNT(DISTINCT d."modelId") = 1
       -- สมาชิกที่หา Device ไม่เจอ = ไม่รู้รุ่นแน่ชัด -> ไม่เติม
       AND COUNT(*) = (SELECT COUNT(*) FROM "CampaignTarget" t2 WHERE t2."campaignId" = t."campaignId")
  ) single
 WHERE c."id" = single."campaignId"
   AND c."name" <> 'ระบบ: คำขอส่ง Config จากหน้างาน (ห้ามลบ — docs/25)';
