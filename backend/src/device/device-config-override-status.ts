import { DeviceConfigOverrideStatus } from '@prisma/client';

/**
 * ค่า status ทั้งหมดของ `DeviceConfigOverride` (issue #223) — ใช้ validate
 * query filter ของ `GET /device-config-overrides` ให้ตรงกับ enum
 * `DeviceConfigOverrideStatus` ใน Prisma schema (pattern เดียวกับ
 * `device-lifecycle-status.ts`/`config-status.ts`)
 *
 * `pending` = ส่งคำขอแล้ว รอ Operation ตัดสินใจ · `approved` = Operation
 * อนุมัติแล้ว (merge เข้า `getCurrentConfig()`) · `rejected` = Operation
 * ปฏิเสธ (ไม่มีผลกับค่า config เลย)
 */
export const DEVICE_CONFIG_OVERRIDE_STATUSES: readonly DeviceConfigOverrideStatus[] =
  ['pending', 'approved', 'rejected'];
