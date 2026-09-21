-- AlterTable
ALTER TABLE "ConfigFieldDefinition" ADD COLUMN     "category" TEXT,
ADD COLUMN     "restartRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sensitive" BOOLEAN NOT NULL DEFAULT false;
