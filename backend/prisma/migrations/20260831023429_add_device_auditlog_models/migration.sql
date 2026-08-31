-- CreateEnum
CREATE TYPE "DeviceLifecycleStatus" AS ENUM ('registered', 'installed', 'decommissioned');

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "simNumber" TEXT NOT NULL,
    "deviceModel" TEXT NOT NULL,
    "protocol" TEXT NOT NULL,
    "status" "DeviceLifecycleStatus" NOT NULL DEFAULT 'registered',
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "installedAt" TIMESTAMP(3),

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "auditModule" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Device_deviceId_key" ON "Device"("deviceId");

-- CreateIndex
-- Partial unique index (ไม่ใช่ @unique เต็มคอลัมน์ใน schema.prisma) — unique
-- เฉพาะ record ที่ status != decommissioned เพื่อให้ SIM ย้ายไปเครื่องใหม่ได้
-- หลัง decommission เครื่องเก่า ตัดสินใจใน PR #38 comment thread
-- (#issuecomment-5474171067 / #issuecomment-5474255608, paveekornkwork-dev,
-- 2026-08-31) — ดูคำเตือนเรื่อง Prisma migrate diff risk ใน schema.prisma
-- เหนือ model Device ก่อนแก้ตาราง Device ในอนาคต
CREATE UNIQUE INDEX "Device_simNumber_active_key" ON "Device"("simNumber")
  WHERE "status" != 'decommissioned';

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
