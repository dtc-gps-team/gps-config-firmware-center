-- AlterTable
ALTER TABLE "DeviceConfigOverride" ADD COLUMN     "consumedAt" TIMESTAMP(3);

-- มติ B 2026-11-03: Override ใช้ครั้งเดียว · แถว approved เดิมที่**มีหลักฐานว่าถูกส่ง
-- ออกไปแล้วหลังอนุมัติ** ถือว่าใช้ไปแล้ว ส่ง Config ครั้งถัดไปจึงได้ค่าต้นฉบับ
-- (รีวิว A #432 ข้อ 2) หลักฐาน = อย่างใดอย่างหนึ่ง
--   1. Rollout target ของ (เครื่อง, Config) เดียวกันสำเร็จหลังเวลาอนุมัติ
--   2. AuditLog `apply-config` ของ (เครื่อง, Config) เดียวกันหลังเวลาอนุมัติ
--      (ทาง apply-config ตรงในโหมด mock ไม่มีร่องรอยอื่นใน DB)
-- แถวที่ไม่มีหลักฐาน (อนุมัติแล้วแต่ยังไม่เคยส่ง) คงไว้ให้ถูกส่งครั้งถัดไปตามเดิม
-- (ส่งซ้ำดีกว่าหายเงียบ) · แถวที่ผูกกับคำขอส่งเข้ากล่องที่ยังไม่ส่งก็ไม่มีหลักฐาน
-- จึงไม่ถูก mark เช่นกัน
UPDATE "DeviceConfigOverride" o
SET "consumedAt" = COALESCE(o."decidedAt", o."overriddenAt")
WHERE o."status" = 'approved'
  AND (
    EXISTS (
      SELECT 1
      FROM "CampaignRolloutTarget" t
      JOIN "CampaignRollout" r ON r."id" = t."rolloutId"
      WHERE t."deviceId" = o."deviceId"
        AND r."configId" = o."configId"
        AND t."status" = 'success'
        AND t."updatedAt" >= COALESCE(o."decidedAt", o."overriddenAt")
    )
    OR EXISTS (
      SELECT 1
      FROM "AuditLog" a
      WHERE a."action" = 'apply-config'
        AND a."metadata"->>'deviceId' = o."deviceId"
        AND a."metadata"->>'configId' = o."configId"
        AND a."createdAt" >= COALESCE(o."decidedAt", o."overriddenAt")
    )
  );
