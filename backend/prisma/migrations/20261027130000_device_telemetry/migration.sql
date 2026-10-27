-- docs/23 PR1: GPS telemetry + เหตุการณ์จากกล่อง (additive ล้วน — 2 ตารางใหม่ + 3 คอลัมน์ nullable บน Device)
-- ตารางใหม่ว่างตอนสร้าง FK จึงไม่มี orphan data

-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "reportedFirmwareAt" TIMESTAMP(3),
ADD COLUMN     "reportedFirmwareVersion" TEXT,
ADD COLUMN     "telemetryKeyHash" TEXT;

-- CreateTable
CREATE TABLE "DeviceTelemetry" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "speedKmh" DOUBLE PRECISION,
    "fix" BOOLEAN NOT NULL,
    "satellites" INTEGER,
    "locationSource" TEXT NOT NULL,
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceTelemetry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceEvent" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "speedKmh" DOUBLE PRECISION,
    "speedLimitKmh" DOUBLE PRECISION,
    "distanceM" DOUBLE PRECISION,
    "radiusM" DOUBLE PRECISION,
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeviceTelemetry_deviceId_recordedAt_idx" ON "DeviceTelemetry"("deviceId", "recordedAt");

-- CreateIndex
CREATE INDEX "DeviceTelemetry_receivedAt_idx" ON "DeviceTelemetry"("receivedAt");

-- CreateIndex
CREATE INDEX "DeviceEvent_deviceId_occurredAt_idx" ON "DeviceEvent"("deviceId", "occurredAt");

-- CreateIndex
CREATE INDEX "DeviceEvent_receivedAt_idx" ON "DeviceEvent"("receivedAt");

-- AddForeignKey
ALTER TABLE "DeviceTelemetry" ADD CONSTRAINT "DeviceTelemetry_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("deviceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceEvent" ADD CONSTRAINT "DeviceEvent_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("deviceId") ON DELETE RESTRICT ON UPDATE CASCADE;

