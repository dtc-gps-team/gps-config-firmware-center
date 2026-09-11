-- AlterTable
ALTER TABLE "Config" ADD COLUMN     "suggestedApproverId" TEXT;

-- AddForeignKey
ALTER TABLE "Config" ADD CONSTRAINT "Config_suggestedApproverId_fkey" FOREIGN KEY ("suggestedApproverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
