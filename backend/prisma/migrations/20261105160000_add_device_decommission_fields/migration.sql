-- ปลดระวางอุปกรณ์ (มติ A 2026-11-05): เก็บเวลาและเหตุผล — additive ไม่แตะแถวเดิม (ค่าเริ่มต้น NULL)
ALTER TABLE "Device" ADD COLUMN "decommissionedAt" TIMESTAMP(3),
ADD COLUMN "decommissionReason" TEXT;
