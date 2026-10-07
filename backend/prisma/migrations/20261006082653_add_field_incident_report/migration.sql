-- AlterEnum
ALTER TYPE "IncidentStatus" ADD VALUE 'dismissed';

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "sourceIncidentId" TEXT;

-- AlterTable
ALTER TABLE "Incident" ADD COLUMN     "deviceId" TEXT,
ADD COLUMN     "reportedBy" TEXT,
ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedBy" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_sourceIncidentId_key" ON "Campaign"("sourceIncidentId");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_sourceIncidentId_fkey" FOREIGN KEY ("sourceIncidentId") REFERENCES "Incident"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_reportedBy_fkey" FOREIGN KEY ("reportedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_reviewedBy_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
