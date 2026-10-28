-- docs/30: Config Override ส่งเข้ากล่องผ่านคำขอส่งเข้ากล่อง + ขอบเขตค่าตัวเลขของ field
-- additive ทั้งหมด (คอลัมน์ nullable ใหม่ ไม่มี backfill ไม่มีข้อมูลเดิมให้ orphan)

-- AlterTable
ALTER TABLE "ConfigApplyRequest" ADD COLUMN "overrideId" TEXT;

-- AlterTable
ALTER TABLE "ConfigFieldDefinition" ADD COLUMN "maxValue" DOUBLE PRECISION,
ADD COLUMN "minValue" DOUBLE PRECISION;

-- CreateIndex
CREATE UNIQUE INDEX "ConfigApplyRequest_overrideId_key" ON "ConfigApplyRequest"("overrideId");

-- AddForeignKey
ALTER TABLE "ConfigApplyRequest" ADD CONSTRAINT "ConfigApplyRequest_overrideId_fkey" FOREIGN KEY ("overrideId") REFERENCES "DeviceConfigOverride"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
