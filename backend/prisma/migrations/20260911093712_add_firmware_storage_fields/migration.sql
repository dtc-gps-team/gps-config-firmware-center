/*
  Warnings:

  - Added the required column `fileSizeBytes` to the `Firmware` table without a default value. This is not possible if the table is not empty.
  - Added the required column `objectKey` to the `Firmware` table without a default value. This is not possible if the table is not empty.
  - Added the required column `originalFilename` to the `Firmware` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
-- ใส่ DEFAULT ชั่วคราวกัน migration พังถ้าตาราง Firmware มีแถวอยู่ก่อนแล้ว
-- (ตอนเขียนตอนแรกคิดว่าตารางว่างทุก env เสมอ — CI migration-safety check
-- (2026-09-14, PR #151 review โดย kittiphong) จับได้ว่าไม่จริงเสมอไป: ถ้ามีแถว
-- เก่าอยู่ก่อน (เช่นทดสอบ manual หรือ deploy คนละจังหวะกับโค้ด) ALTER TABLE
-- แบบ NOT NULL ไม่มี default จะ fail ทันที (Postgres error 23502) — DEFAULT
-- นี้ไม่กระทบโค้ดแอปเลย เพราะ FirmwareService.upload() ส่งค่าจริงทั้ง 3 ฟิลด์
-- เสมอทุกครั้งที่ insert อยู่แล้ว เป็นแค่ safety net สำหรับแถวเก่าที่ไม่มีทาง
-- รู้ค่าจริงย้อนหลังได้
ALTER TABLE "Firmware" ADD COLUMN     "fileSizeBytes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "objectKey" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "originalFilename" TEXT NOT NULL DEFAULT '';
