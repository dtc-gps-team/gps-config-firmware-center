import { ConfigApplyRequestStatus } from '@prisma/client';

/** ค่า status ทั้งหมดของคำขอ — ใช้ validate query ให้ตรงกับ enum ใน Prisma schema */
export const CONFIG_APPLY_REQUEST_STATUSES: readonly ConfigApplyRequestStatus[] =
  [
    'pending',
    'approved',
    'sending',
    'succeeded',
    'failed',
    'skipped_offline',
    'rejected',
    'cancelled',
    'expired',
  ];

/** คำขอที่ยัง "เปิดอยู่" ต่อเครื่อง — มีได้ทีละ 1 คำขอต่อเครื่อง (docs/25 §3.3)
 * · docs/27 เพิ่ม `approved` (อนุมัติแล้วแต่ช่างยังไม่กดส่ง) */
export const OPEN_CONFIG_APPLY_REQUEST_STATUSES: ConfigApplyRequestStatus[] = [
  'pending',
  'approved',
  'sending',
];

/** คำขอ `pending` หมดอายุหลังจากนี้ (docs/25 §3.9, มติ Q9) — 24 ชม. ตามตัวอย่าง
 * ในแผน ยังเป็นค่าที่ต้องยืนยันกับ A (§3.9 "ระยะเวลาจริงตัดสินตอน implement") */
export const CONFIG_APPLY_REQUEST_TTL_HOURS = 24;

/** คำอนุมัติ (`approved`) หมดอายุหลังจากนี้ถ้าช่างไม่กดส่ง (docs/27 D2) */
export const CONFIG_APPLY_APPROVAL_TTL_HOURS = 24;
