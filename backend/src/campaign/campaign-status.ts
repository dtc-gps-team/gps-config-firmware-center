import { CampaignStatus } from '@prisma/client';

/** ค่า status ทั้งหมดของ Campaign — ใช้ validate DTO ให้ตรงกับ enum ใน Prisma
 * schema (pattern เดียวกับ config-status.ts / task-status.ts) */
export const CAMPAIGN_STATUSES: readonly CampaignStatus[] = [
  'draft',
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
export const APPROVABLE_CAMPAIGN_STATUS: CampaignStatus = 'pending_approval';
