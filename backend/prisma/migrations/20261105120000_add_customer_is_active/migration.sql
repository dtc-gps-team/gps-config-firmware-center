-- มติ A 2026-11-05: ลูกค้าปิดใช้งานแทนการลบ (additive, default true ไม่กระทบแถวเดิม)
ALTER TABLE "Customer" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
