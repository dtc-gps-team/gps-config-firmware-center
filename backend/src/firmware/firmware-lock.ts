import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

/**
 * ล็อกแถว `Firmware` เพื่อให้ "ลบ Firmware" ไม่ชนกับการสร้าง reference ใหม่ที่ชี้ Firmware
 * เดียวกัน (review B บน #426 - ระหว่างตรวจว่าไม่ถูกใช้แล้วลบไฟล์ ยังมีคำขอ/Rollout/Override
 * หรือการติดตั้งใหม่แทรกเข้ามา กลายเป็นอ้างถึง Firmware ที่ไฟล์หาย)
 *
 * ทุกเส้นทางที่ **สร้างแถวที่อ้าง Firmware หรือเขียน partition ของกล่อง** (Rollout, Rollback,
 * คำขอส่งเข้ากล่อง, คำขอ Override, ลงทะเบียนอุปกรณ์พร้อม Firmware เริ่มต้น, ยืนยันติดตั้ง,
 * เขียน partition ตอน apply Rollout) ต้องเรียก `lockFirmwareForReference()` ใน transaction
 * เดียวกับการเขียน · ฝั่งลบเรียก `lockFirmwareForDelete()` แล้วตรวจ "ยังถูกใช้งานอยู่" ซ้ำ
 * หลังได้ล็อก:
 * - ผู้สร้างได้ล็อกก่อน -> ผู้ลบรอ แล้วเห็น reference ใหม่ -> 409
 * - ผู้ลบได้ล็อกและตั้ง `deletedAt` ก่อน -> ผู้สร้างรอ แล้วเห็น `deletedAt` -> 409
 */

/** ฝั่งสร้าง reference - ล็อกร่วม (FOR SHARE) หลายคนสร้างพร้อมกันได้ แต่รอผู้ลบ */
export async function lockFirmwareForReference(
  tx: Prisma.TransactionClient,
  firmwareId: string,
): Promise<void> {
  let rows: { deletedAt: Date | null }[];
  try {
    rows = await tx.$queryRaw<{ deletedAt: Date | null }[]>`
      SELECT "deletedAt" FROM "Firmware" WHERE id = ${firmwareId} FOR SHARE`;
  } catch (err) {
    // ผู้เรียกที่เป็น transaction แบบ Serializable (สร้าง Rollout) จะเจอ 40001 เมื่อแถวนี้ถูก
    // อัปเดต (ตั้ง deletedAt) โดยธุรกรรมอื่นระหว่างรอล็อก - Prisma ห่อเป็น P2010
    if (
      err instanceof PrismaClientKnownRequestError &&
      err.code === 'P2010' &&
      err.meta?.code === '40001'
    ) {
      throw new ConflictException(
        'Firmware นี้กำลังถูกลบหรือแก้ไขพร้อมกัน ลองใหม่อีกครั้ง',
      );
    }
    throw err;
  }
  if (rows.length === 0) {
    throw new NotFoundException(`ไม่พบ Firmware id ${firmwareId}`);
  }
  if (rows[0].deletedAt) {
    throw new ConflictException(
      'Firmware นี้ถูกลบไปแล้ว (หรือกำลังถูกลบ) ใช้งานต่อไม่ได้ - เลือก Firmware อื่น',
    );
  }
}

/** ฝั่งลบ - ล็อกเฉพาะตัว (FOR UPDATE) ต้องรอผู้สร้างที่ถือล็อกร่วมอยู่ให้จบก่อน */
export async function lockFirmwareForDelete(
  tx: Prisma.TransactionClient,
  firmwareId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Firmware" WHERE id = ${firmwareId} FOR UPDATE`;
  if (rows.length === 0) {
    throw new NotFoundException(`ไม่พบ Firmware id ${firmwareId}`);
  }
}
