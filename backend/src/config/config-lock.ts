import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

/**
 * ล็อกแถว `Config` เพื่อให้ "ลบ Config" ไม่ชนกับการสร้าง reference ใหม่ที่ชี้มาที่ Config
 * เดียวกัน (review B บน #425 - TOCTOU: ตรวจว่าไม่มีใครใช้แล้วค่อยลบ ระหว่างนั้นอาจมีคำขอ/
 * Rollout/Task/Override ใหม่แทรกเข้ามา กลายเป็นอ้างถึง Config ที่ถูกลบ)
 *
 * ทุกเส้นทางที่ **สร้างแถวที่อ้าง Config** (Rollout, Rollback, คำขอส่งเข้ากล่อง, คำขอ
 * Override, Task ที่ผูก Config) ต้องเรียก `lockConfigForReference()` เป็นคำสั่งแรก ๆ
 * ใน transaction เดียวกับการ insert · ฝั่งลบเรียก `lockConfigForDelete()` แล้วตรวจ
 * "ยังถูกใช้งานอยู่ไหม" ซ้ำหลังได้ล็อก Postgres จึงบังคับให้สองฝั่งต่อคิวกัน:
 * - ผู้สร้างได้ล็อกก่อน -> ผู้ลบรอ แล้วเห็น reference ใหม่ -> 409
 * - ผู้ลบได้ล็อกก่อน -> ผู้สร้างรอ แล้วเห็น `deletedAt` -> 409 (ไม่เกิด reference กำพร้า)
 */

/** ฝั่งสร้าง reference - ล็อกร่วม (FOR SHARE) หลายคนสร้างพร้อมกันได้ แต่รอผู้ลบ */
export async function lockConfigForReference(
  tx: Prisma.TransactionClient,
  configId: string,
): Promise<void> {
  let rows: { deletedAt: Date | null }[];
  try {
    rows = await tx.$queryRaw<{ deletedAt: Date | null }[]>`
      SELECT "deletedAt" FROM "Config" WHERE id = ${configId} FOR SHARE`;
  } catch (err) {
    // ผู้เรียกที่เป็น transaction แบบ Serializable (สร้าง Rollout) จะเจอ 40001 เมื่อแถวนี้ถูก
    // อัปเดต (ลบแบบ soft delete) โดยธุรกรรมอื่นระหว่างรอล็อก - Prisma ห่อเป็น P2010
    if (
      err instanceof PrismaClientKnownRequestError &&
      err.code === 'P2010' &&
      err.meta?.code === '40001'
    ) {
      throw new ConflictException(
        'Config นี้กำลังถูกลบหรือแก้ไขพร้อมกัน ลองใหม่อีกครั้ง',
      );
    }
    throw err;
  }
  if (rows.length === 0) {
    throw new NotFoundException(`ไม่พบ Config id ${configId}`);
  }
  if (rows[0].deletedAt) {
    throw new ConflictException(
      'Config นี้ถูกลบไปแล้ว (หรือกำลังถูกลบ) ใช้งานต่อไม่ได้ - เลือก Config อื่น',
    );
  }
}

/** ฝั่งลบ - ล็อกเฉพาะตัว (FOR UPDATE) ต้องรอผู้สร้างที่ถือล็อกร่วมอยู่ให้จบก่อน */
export async function lockConfigForDelete(
  tx: Prisma.TransactionClient,
  configId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Config" WHERE id = ${configId} FOR UPDATE`;
  if (rows.length === 0) {
    throw new NotFoundException(`ไม่พบ Config id ${configId}`);
  }
}
