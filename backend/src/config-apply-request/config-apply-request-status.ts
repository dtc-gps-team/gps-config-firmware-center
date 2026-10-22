import { ConfigApplyRequestStatus } from '@prisma/client';

/** ค่า status ทั้งหมดของคำขอ — ใช้ validate query ให้ตรงกับ enum ใน Prisma schema */
export const CONFIG_APPLY_REQUEST_STATUSES: readonly ConfigApplyRequestStatus[] =
  [
    'pending',
    'sending',
    'succeeded',
    'failed',
    'skipped_offline',
    'rejected',
    'cancelled',
    'expired',
  ];

/** คำขอที่ยัง "เปิดอยู่" ต่อเครื่อง — มีได้ทีละ 1 คำขอต่อเครื่อง (docs/25 §3.3) */
export const OPEN_CONFIG_APPLY_REQUEST_STATUSES: ConfigApplyRequestStatus[] = [
  'pending',
  'sending',
];

/** คำขอ `pending` หมดอายุหลังจากนี้ (docs/25 §3.9, มติ Q9) — 24 ชม. ตามตัวอย่าง
 * ในแผน ยังเป็นค่าที่ต้องยืนยันกับ A (§3.9 "ระยะเวลาจริงตัดสินตอน implement") */
export const CONFIG_APPLY_REQUEST_TTL_HOURS = 24;
