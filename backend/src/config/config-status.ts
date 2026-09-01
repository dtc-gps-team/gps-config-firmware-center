import { ConfigStatus } from '@prisma/client';

/**
 * ค่า status ทั้งหมดของ Config — ใช้ validate DTO ให้ตรงกับ enum ใน Prisma
 * schema (pattern เดียวกับ task-status.ts) ขั้นเดียว ไม่มี sw_approved
 * (ยืนยันกับ kittiphong แล้วบน issue #26 — ดู schema.prisma comment)
 */
export const CONFIG_STATUSES: readonly ConfigStatus[] = [
  'draft',
  'testing',
  'approved',
  'rejected',
  'synced',
];

/** สถานะที่ยังแก้ไข/ลบได้ — Stage 1 (CRUD) เท่านั้น ยังไม่มี testing/approved/rejected/synced ใน scope นี้ */
export const EDITABLE_CONFIG_STATUS: ConfigStatus = 'draft';
