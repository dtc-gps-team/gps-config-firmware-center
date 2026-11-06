import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * ล็อกแถว `Device` เพื่อให้ "ปลดระวาง/แก้ไขอุปกรณ์" ไม่ชนกับการสร้างงานใหม่ที่อ้างเครื่องนั้น
 * (แพทเทิร์นเดียวกับ `customer-lock.ts`/`config-lock.ts` — TOCTOU: ตรวจว่าไม่มีงานค้างแล้วค่อยปลดระวาง
 * ระหว่างนั้นอาจมีคำขอส่งเข้ากล่อง/Override ใหม่ถูกสร้างขึ้นมา กลายเป็นงานที่อ้างเครื่องที่ปลดระวางแล้ว)
 *
 * งานเหล่านี้อ้างเครื่องด้วยเลขเครื่อง (`Device.deviceId`) เป็น string ไม่มี FK ฐานข้อมูลจึงกันให้ไม่ได้
 *
 * - ผู้สร้างงาน (คำขอส่งเข้ากล่อง, Override, สร้าง/แก้/เริ่มงาน) เรียก `lockDeviceForUse()` ใน transaction เดียวกับการ insert
 * - ผู้ปลดระวาง/แก้ไขเรียก `lockDeviceForChange()` แล้วตรวจ "มีงานค้างไหม" ซ้ำหลังได้ล็อก
 *   Postgres จึงบังคับให้สองฝั่งต่อคิวกัน
 */

/** ฝั่งสร้างงานที่อ้างเครื่อง - ล็อกร่วม (FOR KEY SHARE) หลายคนสร้างพร้อมกันได้ แต่รอผู้ปลดระวางให้จบก่อน
 * เครื่องที่ปลดระวางแล้ว = 409 (สร้างงานใหม่ให้เครื่องนี้ไม่ได้)
 *
 * ใช้ `FOR KEY SHARE` ไม่ใช่ `FOR SHARE` (รีวิว B บน #452): ชนกับ `FOR UPDATE` ของผู้ปลดระวางอยู่แล้ว
 * แต่ไม่ชนกับ `UPDATE` ธรรมดาของคอลัมน์ที่ไม่ใช่คีย์ เช่น `lastSeenAt` ที่ `DeviceApiKeyGuard` เขียนทุกนาที
 * และ `reportedFirmwareVersion` จาก telemetry — กล่องที่ส่งข้อมูลถี่จึงไม่ต้องรอผู้สร้างงาน */
export async function lockDeviceForUse(
  tx: Prisma.TransactionClient,
  deviceId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<{ status: string }[]>`
    SELECT status::text AS status FROM "Device" WHERE "deviceId" = ${deviceId} FOR KEY SHARE`;
  if (rows.length === 0) {
    throw new NotFoundException(`ไม่พบ Device deviceId ${deviceId}`);
  }
  if (rows[0].status === 'decommissioned') {
    throw new ConflictException(
      `เครื่อง ${deviceId} ปลดระวางแล้ว สร้างงานใหม่ให้เครื่องนี้ไม่ได้ - เปิดใช้งานเครื่องกลับก่อน`,
    );
  }
}

/** ฝั่งปลดระวาง/เปิดใช้กลับ/แก้ไข - ล็อกเฉพาะตัว (FOR UPDATE) ต้องรอผู้สร้างงานที่ถือล็อกร่วมอยู่ให้จบก่อน
 * คืนสถานะปัจจุบันหลังได้ล็อก (ใช้ตัดสินว่าทำรายการนี้ได้ไหม) */
export async function lockDeviceForChange(
  tx: Prisma.TransactionClient,
  deviceId: string,
): Promise<{ status: string }> {
  const rows = await tx.$queryRaw<{ status: string }[]>`
    SELECT status::text AS status FROM "Device" WHERE "deviceId" = ${deviceId} FOR UPDATE`;
  if (rows.length === 0) {
    throw new NotFoundException(`ไม่พบ Device deviceId ${deviceId}`);
  }
  return rows[0];
}
