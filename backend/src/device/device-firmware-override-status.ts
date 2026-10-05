import { DeviceFirmwareOverrideStatus } from '@prisma/client';

/**
 * ค่า status ทั้งหมดของ `DeviceFirmwareOverride` (Sprint 3 แถวที่ 24) — ใช้
 * validate query filter ของ `GET /device-firmware-overrides` ให้ตรงกับ enum
 * `DeviceFirmwareOverrideStatus` ใน Prisma schema (pattern เดียวกับ
 * `device-config-override-status.ts`)
 *
 * `pending` = ส่งคำขอแล้ว รอ Operation ตัดสินใจ · `approved` = Operation
 * อนุมัติแล้ว (ปลดล็อกให้ `confirmFirmwareInstall()` ยอมรับ firmware นี้กับ
 * อุปกรณ์เครื่องนี้ได้) · `rejected` = Operation ปฏิเสธ (ไม่มีผลอะไรเลย)
 */
export const DEVICE_FIRMWARE_OVERRIDE_STATUSES: readonly DeviceFirmwareOverrideStatus[] =
  ['pending', 'approved', 'rejected'];
