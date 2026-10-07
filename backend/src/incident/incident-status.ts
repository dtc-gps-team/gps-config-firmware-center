import { IncidentSeverity, IncidentStatus } from '@prisma/client';

/** ค่า severity ทั้งหมดของ Incident — ใช้ validate `CreateIncidentDto`
 * (ไม่เคยมี endpoint สร้างเองมาก่อน issue #236 เลยไม่เคยต้อง validate ค่านี้) */
export const INCIDENT_SEVERITIES: readonly IncidentSeverity[] = [
  'critical',
  'high',
  'medium',
  'low',
];

/**
 * ค่า status ทั้งหมดของ Incident — ใช้ validate DTO ให้ตรงกับ enum
 * `IncidentStatus` ใน Prisma schema (pattern เดียวกับ device-lifecycle-status.ts
 * / config-status.ts)
 *
 * `open` = เพิ่งเกิด ยังไม่มีใครดู · `investigating` = กำลังตรวจสอบ (field
 * report ที่ถูก promote เป็น Campaign ก็ใช้สถานะนี้) · `rolled_back` = ย้อน
 * Config/Firmware กลับแล้ว · `resolved` = ปิดเคส (ปัญหาจริง แก้แล้วนอกเหนือ
 * Campaign) · `dismissed` = ไม่ใช่ปัญหาจริง/ซ้ำ (issue #236)
 */
export const INCIDENT_STATUSES: readonly IncidentStatus[] = [
  'open',
  'investigating',
  'rolled_back',
  'resolved',
  'dismissed',
];

/** outcome ที่ Operation เลือกได้ตอน `POST /incidents/:id/decide` (issue #236)
 * — mirror ชื่อ field `IncidentStatus` ที่แต่ละ outcome นำไปสู่ แต่ไม่ใช่ค่า
 * เดียวกันเป๊ะ (`promote` → `investigating` ไม่ใช่ `promoted`) จึงแยก type
 * ต่างหากจาก `IncidentStatus` */
export const INCIDENT_DECISION_OUTCOMES = [
  'resolve',
  'dismiss',
  'promote',
] as const;

export type IncidentDecisionOutcome =
  (typeof INCIDENT_DECISION_OUTCOMES)[number];
