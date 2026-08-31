-- CreateEnum
CREATE TYPE "ConfigStatus" AS ENUM ('draft', 'testing', 'approved', 'rejected', 'synced');

-- CreateEnum
CREATE TYPE "FirmwareUploadStatus" AS ENUM ('pending', 'stored', 'failed');

-- CreateEnum
CREATE TYPE "FirmwareDeviceUpdateStatus" AS ENUM ('unknown', 'up_to_date', 'pending_update');

-- CreateEnum
CREATE TYPE "CampaignPayloadType" AS ENUM ('Config', 'Firmware');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('draft', 'active', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "IncidentSeverity" AS ENUM ('critical', 'high', 'medium', 'low');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('open', 'investigating', 'rolled_back', 'resolved');

-- CreateTable
CREATE TABLE "Config" (
    "id" TEXT NOT NULL,
    "deviceModel" TEXT NOT NULL,
    "protocol" TEXT NOT NULL,
    "status" "ConfigStatus" NOT NULL DEFAULT 'draft',
    "fields" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Firmware" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "deviceModelCompatibility" TEXT[],
    "uploadStatus" "FirmwareUploadStatus" NOT NULL DEFAULT 'pending',
    "deviceUpdateStatus" "FirmwareDeviceUpdateStatus" NOT NULL DEFAULT 'unknown',
    "uploadedBy" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Firmware_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "payloadType" "CampaignPayloadType" NOT NULL,
    "configId" TEXT,
    "firmwareId" TEXT,
    "status" "CampaignStatus" NOT NULL DEFAULT 'draft',
    "targetCount" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "severity" "IncidentSeverity" NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'open',
    "relatedConfigId" TEXT,
    "relatedFirmwareId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Config" ADD CONSTRAINT "Config_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Config" ADD CONSTRAINT "Config_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Firmware" ADD CONSTRAINT "Firmware_uploadedBy_fkey" FOREIGN KEY ("uploadedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_configId_fkey" FOREIGN KEY ("configId") REFERENCES "Config"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_firmwareId_fkey" FOREIGN KEY ("firmwareId") REFERENCES "Firmware"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_relatedConfigId_fkey" FOREIGN KEY ("relatedConfigId") REFERENCES "Config"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_relatedFirmwareId_fkey" FOREIGN KEY ("relatedFirmwareId") REFERENCES "Firmware"("id") ON DELETE SET NULL ON UPDATE CASCADE;
