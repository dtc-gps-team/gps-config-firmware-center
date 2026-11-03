-- AlterTable
ALTER TABLE "DeviceConfigOverride" ADD COLUMN     "consumedAt" TIMESTAMP(3);

-- มติ B 2026-11-03: Override ใช้ครั้งเดียว · แถว approved เดิมถูก merge เข้าทุกการส่ง
-- มาตลอด ถือว่าใช้ไปแล้ว ส่ง Config ครั้งถัดไปจึงได้ค่าต้นฉบับ · ยกเว้นแถวที่ผูกกับ
-- คำขอส่งเข้ากล่องที่ยังไม่ได้ส่ง (approved, ยังไม่มี Rollout) ให้คำขอนั้นพาค่าเข้ากล่อง
UPDATE "DeviceConfigOverride" o
SET "consumedAt" = COALESCE(o."decidedAt", o."overriddenAt")
WHERE o."status" = 'approved'
  AND NOT EXISTS (
    SELECT 1 FROM "ConfigApplyRequest" r
    WHERE r."overrideId" = o."id"
      AND r."status" = 'approved'
      AND r."rolloutId" IS NULL
  );
