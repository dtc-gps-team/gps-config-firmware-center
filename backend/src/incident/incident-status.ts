import { IncidentStatus } from '@prisma/client';

/**
 * ค่า status ทั้งหมดของ Incident — ใช้ validate DTO ให้ตรงกับ enum
 * `IncidentStatus` ใน Prisma schema (pattern เดียวกับ device-lifecycle-status.ts
 * / config-status.ts)
 *
 * `open` = เพิ่งเกิด ยังไม่มีใครดู · `investigating` = กำลังตรวจสอบ ·
 * `rolled_back` = ย้อน Config/Firmware กลับแล้ว · `resolved` = ปิดเคส
 */
export const INCIDENT_STATUSES: readonly IncidentStatus[] = [
  'open',
  'investigating',
  'rolled_back',
  'resolved',
];
