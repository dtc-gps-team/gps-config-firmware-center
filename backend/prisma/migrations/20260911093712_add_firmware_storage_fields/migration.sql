/*
  Warnings:

  - Added the required column `fileSizeBytes` to the `Firmware` table without a default value. This is not possible if the table is not empty.
  - Added the required column `objectKey` to the `Firmware` table without a default value. This is not possible if the table is not empty.
  - Added the required column `originalFilename` to the `Firmware` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Firmware" ADD COLUMN     "fileSizeBytes" INTEGER NOT NULL,
ADD COLUMN     "objectKey" TEXT NOT NULL,
ADD COLUMN     "originalFilename" TEXT NOT NULL;
