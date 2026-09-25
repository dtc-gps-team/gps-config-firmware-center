import { CampaignRolloutStatus } from '@prisma/client';

/** ค่า status ทั้งหมดของ CampaignRollout — ใช้ validate DTO ให้ตรงกับ enum ใน
 * Prisma schema (pattern เดียวกับ config-status.ts / task-status.ts) —
 * ย้ายมาจาก `campaign-status.ts` เดิม (แก้ไข 2026-09-24, ดู comment เหนือ
 * `model Campaign` ใน schema.prisma) ไม่มี `draft` อีกต่อไป — rollout สร้าง
 * แล้วเป็น `pending_approval` ทันทีเสมอ */
export const CAMPAIGN_ROLLOUT_STATUSES: readonly CampaignRolloutStatus[] = [
  'pending_approval',
  'active',
  'paused',
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
 * รอบเดิมค้างอยู่ (มติ 2026-09-24: กลุ่มหนึ่งรัน rollout ได้ทีละรอบเท่านั้น)
 * `paused` นับรวมด้วย (แก้ไข 2026-09-24, Incident & Rollback #28 — Auto
 * Pause) เพราะยังไม่จบเหมือนกัน — **แต่ `resume`/`rollback` ไม่เช็ค list นี้
 * เลย** (ดู comment เหนือ `CampaignRolloutService.resume`/`rollback`) เพราะ
 * สองอันนั้นคือวิธี "แก้ปัญหารอบที่ค้างอยู่" ไม่ใช่การเริ่มงานใหม่ */
export const OPEN_CAMPAIGN_ROLLOUT_STATUSES: readonly CampaignRolloutStatus[] =
  ['pending_approval', 'active', 'paused'];

/** เกณฑ์ Auto Pause (Incident & Rollback #28) — mirror
 * GPS_Config_Firmware_Center_Design.pdf §11.2/หลักการข้อ 22 ("ต้อง Auto
 * Pause เมื่อ Failure เกิน Threshold") เอกสารระบุ 5% ตรงๆ ไม่ใช่ค่าที่คิดเอง */
export const AUTO_PAUSE_FAILURE_RATE_THRESHOLD = 0.05;

/** สถานะที่ `resume()` ทำได้ — ต้องเป็น `paused` เท่านั้น */
export const RESUMABLE_CAMPAIGN_ROLLOUT_STATUS: CampaignRolloutStatus =
  'paused';

/** สถานะที่ `rollback()` ทำได้ — ต้องเคย push จริงไปแล้วอย่างน้อยบางส่วน
 * (`active`/`paused`/`completed`) — `pending_approval`/`rejected`/`cancelled`
 * ไม่เคยมีอะไรถูกส่งไปอุปกรณ์เลยจริงๆ จึงไม่มีอะไรให้ rollback */
export const ROLLBACKABLE_CAMPAIGN_ROLLOUT_STATUSES: readonly CampaignRolloutStatus[] =
  ['active', 'paused', 'completed'];
