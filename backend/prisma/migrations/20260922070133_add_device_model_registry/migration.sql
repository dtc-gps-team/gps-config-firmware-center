-- CreateEnum
CREATE TYPE "DeviceModelStatus" AS ENUM ('active', 'discontinued');

-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "hardwareRevisionCode" TEXT,
ADD COLUMN     "modelId" TEXT;

-- CreateTable
CREATE TABLE "DeviceModel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "manufacturer" TEXT,
    "supportedProtocols" TEXT[],
    "status" "DeviceModelStatus" NOT NULL DEFAULT 'active',
    "warrantyMonths" INTEGER,
    "endOfSupportDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceModel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeviceModel_name_key" ON "DeviceModel"("name");

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "DeviceModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
