-- ฟีดแบ็ก 2026-11-04: เปิดให้พารามิเตอร์หนึ่งตัวประกาศว่า "ใช้ได้กับทุกโมเดล"
-- แทนที่จะต้องเลือกทีละรุ่นใน supportedModels เสมอ — additive column, default
-- false ปลอดภัยกับแถวเดิมทั้งหมด (พฤติกรรมเดิมไม่เปลี่ยน)
ALTER TABLE "ConfigFieldDefinition" ADD COLUMN "appliesToAllModels" BOOLEAN NOT NULL DEFAULT false;
