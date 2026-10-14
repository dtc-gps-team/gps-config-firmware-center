-- AlterTable
ALTER TABLE "Config" ADD COLUMN     "clonedFromId" TEXT;

-- AddForeignKey
ALTER TABLE "Config" ADD CONSTRAINT "Config_clonedFromId_fkey" FOREIGN KEY ("clonedFromId") REFERENCES "Config"("id") ON DELETE SET NULL ON UPDATE CASCADE;
