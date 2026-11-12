import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * ล็อกแถว `DeviceModel` เพื่อให้ "ลบรุ่น" ไม่ชนกับการสร้าง/แก้ Config ที่อ้างรุ่นนั้น (แนวทางเดียวกับ
 * config-lock.ts / config-definition-lock.ts — review B บน #425):
 * - Config อ้างรุ่นด้วย `modelId` (FK Restrict, 12 พ.ย. 2569) ฐานข้อมูลจึงไม่ยอมให้เหลือ Config ที่อ้างรุ่นที่ไม่มี
 *   แต่ถ้าไม่ล็อก การสร้าง Config ที่ชนกับการลบรุ่นพอดีจะได้ FK error (500) แทนข้อความที่อ่านรู้เรื่อง
 *   - ฝั่งสร้าง/แก้ Config: `lockDeviceModelForUse()` (FOR SHARE) ใน transaction เดียวกับการเขียน
 *   - ฝั่งลบ: `lockDeviceModelForDelete()` (FOR UPDATE) แล้วตรวจ "ยังมีอะไรอ้างอยู่ไหม" ซ้ำหลังได้ล็อก
 * - Device อ้างด้วย `modelId` (FK) เหมือนกัน
 * - Firmware (`deviceModelCompatibility`) และ Parameter (`supportedModels`) ปัจจุบันไม่บังคับให้ชื่อรุ่นอยู่ใน
 *   ทะเบียนตั้งแต่ต้น (เป็น string อิสระ) จึงไม่มีสัญญา "ต้องมีรุ่นนี้อยู่" ให้ล็อกปกป้อง — ถูกนับเป็นตัวบล็อกการลบเท่านั้น
 */

/** ฝั่งสร้าง/แก้ Config - ล็อกร่วม (FOR SHARE) หลายคนพร้อมกันได้ แต่รอผู้ลบ · รุ่นหาย -> 409 */
export async function lockDeviceModelForUse(
  tx: Prisma.TransactionClient,
  modelId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "DeviceModel" WHERE id = ${modelId} FOR SHARE`;
  if (rows.length === 0) {
    throw new ConflictException(
      `รุ่นอุปกรณ์ id ${modelId} ถูกลบออกจากทะเบียนไปแล้ว - ตรวจรายการรุ่นแล้วลองใหม่`,
    );
  }
}

/** ฝั่งลบ - ล็อกเฉพาะตัว (FOR UPDATE) ต้องรอผู้สร้าง/แก้ Config ที่ถือล็อกร่วมอยู่ให้จบก่อน */
export async function lockDeviceModelForDelete(
  tx: Prisma.TransactionClient,
  id: string,
): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "DeviceModel" WHERE id = ${id} FOR UPDATE`;
  if (rows.length === 0) {
    throw new NotFoundException(`ไม่พบรุ่นอุปกรณ์ id ${id}`);
  }
}
