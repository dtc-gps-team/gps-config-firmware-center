-- CreateEnum
CREATE TYPE "DeviceConfigOverrideStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "DeviceConfigOverride" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "fields" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "DeviceConfigOverrideStatus" NOT NULL DEFAULT 'pending',
    "overriddenBy" TEXT NOT NULL,
    "overriddenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "rejectReason" TEXT,

    CONSTRAINT "DeviceConfigOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeviceConfigOverride_deviceId_idx" ON "DeviceConfigOverride"("deviceId");

-- CreateIndex
CREATE INDEX "DeviceConfigOverride_status_idx" ON "DeviceConfigOverride"("status");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceConfigOverride_deviceId_versionNumber_key" ON "DeviceConfigOverride"("deviceId", "versionNumber");

-- AddForeignKey
ALTER TABLE "DeviceConfigOverride" ADD CONSTRAINT "DeviceConfigOverride_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("deviceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceConfigOverride" ADD CONSTRAINT "DeviceConfigOverride_configId_fkey" FOREIGN KEY ("configId") REFERENCES "Config"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceConfigOverride" ADD CONSTRAINT "DeviceConfigOverride_overriddenBy_fkey" FOREIGN KEY ("overriddenBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceConfigOverride" ADD CONSTRAINT "DeviceConfigOverride_decidedBy_fkey" FOREIGN KEY ("decidedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
