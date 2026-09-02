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

/** สถานะที่ยังทดสอบกับ Device Simulator ได้ (Stage 3) — บล็อกถ้า `approved`/
 * `synced`/`rejected` ไปแล้ว ตาม 409 ที่ระบุใน docs/api/openapi.yaml
 * (`simulateConfig`): "สถานะ Config ปัจจุบันไม่รองรับการทดสอบ (เช่น
 * approved/synced ไปแล้ว)" — รวม `testing` ไว้ด้วยเพราะ SW ต้องทดสอบซ้ำได้
 * ระหว่างที่ยังไม่ตัดสินใจปักผล (ขั้นตัดสินใจเองยังเป็น open question ที่ยัง
 * ไม่ปิด — ดู docs/architecture/RBAC_Matrix.md Section 6) */
export const SIMULATABLE_CONFIG_STATUSES: readonly ConfigStatus[] = [
  'draft',
  'testing',
];

/** สถานะที่ SW ปักผลตัดสินใจได้ (Stage 4, `decideConfig`) — ต้องเป็น `draft`
 * เท่านั้น ตรงกับ 409 ที่ระบุใน docs/api/openapi.yaml: "สถานะ Config ปัจจุบัน
 * ไม่ใช่ draft จึงปักผลตัดสินใจไม่ได้ (เช่น ยังไม่เคย simulate เลย หรือส่งต่อ
 * Operation ไปแล้ว)" — กันไม่ให้กด decide ซ้ำหลังส่งต่อ Operation แล้ว
 * (`testing`) หรือกดหลัง Operation ตัดสินใจไปแล้ว (`approved`/`rejected`) */
export const DECIDABLE_CONFIG_STATUS: ConfigStatus = 'draft';

/** สถานะที่ Operation อนุมัติ/ปฏิเสธได้ (Stage 4, `approveConfig`/
 * `rejectConfig`) — ต้องเป็น `testing` เท่านั้น (SW ต้อง `decide(passed:true)`
 * ส่งต่อมาก่อน) ตรงกับ 409 ของทั้งสอง endpoint ใน docs/api/openapi.yaml ที่
 * ระบุเงื่อนไขเดียวกันเป๊ะๆ */
export const APPROVABLE_CONFIG_STATUS: ConfigStatus = 'testing';
