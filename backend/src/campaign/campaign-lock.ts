import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

/**
 * ธุรกรรมชนกันจนต้องลองใหม่หรือไม่ - Postgres ตอบ serialization failure (40001): Prisma
 * แปลงเป็น `P2034` ถ้าเกิดจากคำสั่งปกติ แต่ถ้าเกิดจาก `$queryRaw` (เช่นล็อกแถวที่เพิ่งถูกลบ
 * โดยธุรกรรมอื่น) จะเป็น `P2010` พร้อม `meta.code = '40001'`
 */
export function isSerializationFailure(err: unknown): boolean {
  if (!(err instanceof PrismaClientKnownRequestError)) return false;
  if (err.code === 'P2034') return true;
  return err.code === 'P2010' && err.meta?.code === '40001';
}

/**
 * ล็อกแถว `Campaign` ใน transaction ที่เรียก เพื่อให้การ "ตรวจว่ากลุ่มนี้ยังว่าง
 * (ไม่มี Rollout ค้าง) แล้วค่อยแก้สมาชิก/ลบ" ไม่ชนกับการสร้าง Rollout ใหม่ในกลุ่ม
 * เดียวกัน (review B บน #424):
 * - `update` (FOR UPDATE) - ฝั่งที่แก้สมาชิก/ลบกลุ่ม ต้องรอ transaction ที่ถือ share
 *   อยู่ให้จบก่อน แล้วตรวจ Rollout ค้างซ้ำ "หลังได้ล็อก" ถึงจะเห็นรอบที่เพิ่งสร้าง
 * - `share` (FOR SHARE) - ฝั่งที่สร้าง Rollout (สร้างพร้อมกันหลายตัวได้) แต่รอ
 *   transaction ที่ลบ/แก้สมาชิกอยู่ให้จบก่อน
 * ต้องเรียกเป็นคำสั่งแรกของ transaction · กลุ่มที่ถูกลบไปแล้ว = 404
 */
export async function lockCampaign(
  tx: Prisma.TransactionClient,
  campaignId: string,
  mode: 'share' | 'update',
): Promise<void> {
  const rows =
    mode === 'update'
      ? await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM "Campaign" WHERE id = ${campaignId} FOR UPDATE`
      : await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM "Campaign" WHERE id = ${campaignId} FOR SHARE`;
  if (rows.length === 0) {
    throw new NotFoundException(`ไม่พบ Campaign id ${campaignId}`);
  }
}
