-- AlterTable
ALTER TABLE "ConfigFieldDefinition" ADD COLUMN     "stOverridable" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ConfigVersion" ADD COLUMN     "reason" TEXT;
