import { DeviceLifecycleStatus } from '@prisma/client';

/**
 * ค่า status ทั้งหมดของ Device — ใช้ validate DTO ให้ตรงกับ enum
 * `DeviceLifecycleStatus` ใน Prisma schema (pattern เดียวกับ config-status.ts)
 *
 * `registered` = ลงทะเบียนแล้วยังไม่ติดตั้ง · `installed` = ติดตั้งบนรถจริงแล้ว
 * · `decommissioned` = ปลดระวาง (ไม่ลบ row จริง — ดู schema.prisma comment)
 */
export const DEVICE_LIFECYCLE_STATUSES: readonly DeviceLifecycleStatus[] = [
  'registered',
  'installed',
  'decommissioned',
];
