import { CampaignStatus } from '@prisma/client';

/** ค่า status ทั้งหมดของ Campaign — ใช้ validate DTO ให้ตรงกับ enum ใน Prisma
 * schema (pattern เดียวกับ config-status.ts / task-status.ts) */
export const CAMPAIGN_STATUSES: readonly CampaignStatus[] = [
  'draft',
  'active',
  'completed',
  'cancelled',
];
