import { CampaignRolloutStatus } from '@prisma/client';

/** ค่า status ทั้งหมดของ CampaignRollout — ใช้ validate DTO ให้ตรงกับ enum ใน
 * Prisma schema (pattern เดียวกับ config-status.ts / task-status.ts) —
 * ย้ายมาจาก `campaign-status.ts` เดิม (แก้ไข 2026-09-24, ดู comment เหนือ
 * `model Campaign` ใน schema.prisma) ไม่มี `draft` อีกต่อไป — rollout สร้าง
 * แล้วเป็น `pending_approval` ทันทีเสมอ */
export const CAMPAIGN_ROLLOUT_STATUSES: readonly CampaignRolloutStatus[] = [
  'pending_approval',
  'active',
  'rejected',
  'completed',
  'cancelled',
];

/** สถานะที่ Operation อนุมัติ/ปฏิเสธได้ (Campaign Approval, แก้ครั้งที่ 39) —
 * ต้องเป็น `pending_approval` เท่านั้น mirror `APPROVABLE_CONFIG_STATUS`/
 * `DECIDABLE_FIRMWARE_APPROVAL_STATUS` — กันกด approve/reject ซ้ำหลัง
 * ตัดสินใจไปแล้วครั้งหนึ่ง */
export const APPROVABLE_CAMPAIGN_ROLLOUT_STATUS: CampaignRolloutStatus =
  'pending_approval';

/** สถานะที่ยัง "ไม่จบ" ของกลุ่มหนึ่งกลุ่ม — กันสร้าง rollout ใหม่ซ้อนถ้ายังมี
 * รอบเดิมค้างอยู่ (มติ 2026-09-24: กลุ่มหนึ่งรัน rollout ได้ทีละรอบเท่านั้น) */
export const OPEN_CAMPAIGN_ROLLOUT_STATUSES: readonly CampaignRolloutStatus[] =
  ['pending_approval', 'active'];
