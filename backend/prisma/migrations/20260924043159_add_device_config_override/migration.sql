-- CreateTable
CREATE TABLE "DeviceConfigOverride" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "fields" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "overriddenBy" TEXT NOT NULL,
    "overriddenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceConfigOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeviceConfigOverride_deviceId_idx" ON "DeviceConfigOverride"("deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceConfigOverride_deviceId_versionNumber_key" ON "DeviceConfigOverride"("deviceId", "versionNumber");

-- AddForeignKey
ALTER TABLE "DeviceConfigOverride" ADD CONSTRAINT "DeviceConfigOverride_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("deviceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceConfigOverride" ADD CONSTRAINT "DeviceConfigOverride_configId_fkey" FOREIGN KEY ("configId") REFERENCES "Config"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceConfigOverride" ADD CONSTRAINT "DeviceConfigOverride_overriddenBy_fkey" FOREIGN KEY ("overriddenBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
