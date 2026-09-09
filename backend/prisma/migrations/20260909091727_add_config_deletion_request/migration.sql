-- CreateEnum
CREATE TYPE "ConfigDeletionRequestStatus" AS ENUM ('pending', 'approved', 'rejected', 'cancelled');

-- AlterTable
ALTER TABLE "Config" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ConfigDeletionRequest" (
    "id" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ConfigDeletionRequestStatus" NOT NULL DEFAULT 'pending',
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "decisionNote" TEXT,

    CONSTRAINT "ConfigDeletionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConfigDeletionRequest_configId_idx" ON "ConfigDeletionRequest"("configId");

-- CreateIndex
CREATE INDEX "ConfigDeletionRequest_status_idx" ON "ConfigDeletionRequest"("status");

-- AddForeignKey
ALTER TABLE "ConfigDeletionRequest" ADD CONSTRAINT "ConfigDeletionRequest_configId_fkey" FOREIGN KEY ("configId") REFERENCES "Config"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfigDeletionRequest" ADD CONSTRAINT "ConfigDeletionRequest_reviewedBy_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
