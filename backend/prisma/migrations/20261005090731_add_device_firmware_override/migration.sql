-- CreateEnum
CREATE TYPE "DeviceFirmwareOverrideStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "DeviceFirmwareOverride" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "firmwareId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "DeviceFirmwareOverrideStatus" NOT NULL DEFAULT 'pending',
    "overriddenBy" TEXT NOT NULL,
    "overriddenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "rejectReason" TEXT,

    CONSTRAINT "DeviceFirmwareOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeviceFirmwareOverride_deviceId_idx" ON "DeviceFirmwareOverride"("deviceId");

-- CreateIndex
CREATE INDEX "DeviceFirmwareOverride_status_idx" ON "DeviceFirmwareOverride"("status");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceFirmwareOverride_deviceId_versionNumber_key" ON "DeviceFirmwareOverride"("deviceId", "versionNumber");

-- AddForeignKey
ALTER TABLE "DeviceFirmwareOverride" ADD CONSTRAINT "DeviceFirmwareOverride_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("deviceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceFirmwareOverride" ADD CONSTRAINT "DeviceFirmwareOverride_firmwareId_fkey" FOREIGN KEY ("firmwareId") REFERENCES "Firmware"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceFirmwareOverride" ADD CONSTRAINT "DeviceFirmwareOverride_overriddenBy_fkey" FOREIGN KEY ("overriddenBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceFirmwareOverride" ADD CONSTRAINT "DeviceFirmwareOverride_decidedBy_fkey" FOREIGN KEY ("decidedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
