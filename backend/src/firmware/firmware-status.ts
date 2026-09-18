import { FirmwareApprovalStatus, FirmwareUploadStatus } from '@prisma/client';

/** สถานะอัปโหลด/จัดเก็บฝั่งเรา (v3.7 — ทางเดียว ไม่มีช่องทาง "ดึงจากระบบเดิม"
 * แล้ว) — ตรงกับ enum ใน Prisma schema */
export const FIRMWARE_UPLOAD_STATUSES: readonly FirmwareUploadStatus[] = [
  'pending',
  'stored',
  'failed',
];

/** สถานะที่ทดสอบกับ Device Simulator ได้ — ต้อง `stored` แล้วเท่านั้น (ไฟล์อยู่
 * ใน Object Storage จริง) ตรงกับ 409 ที่ระบุใน docs/api/openapi.yaml
 * (`simulateFirmware`): "uploadStatus ของ Firmware ยังไม่พร้อมทดสอบ" */
export const SIMULATABLE_FIRMWARE_STATUS: FirmwareUploadStatus = 'stored';

/**
 * Firmware Approval Lifecycle (docs/13_Role_Redesign_Proposal.md §3.2) — คนละ
 * มิติกับ uploadStatus ด้านบน (pattern เดียวกับ config-status.ts ที่แยก
 * DECIDABLE/APPROVABLE ออกจาก EDITABLE) ตรงกับ enum ใน Prisma schema
 */
export const FIRMWARE_APPROVAL_STATUSES: readonly FirmwareApprovalStatus[] = [
  'pending_review',
  'approved',
  'rejected',
];

/** ใช้ตรวจสอบว่า Firmware "ใช้ใน Campaign ได้" ไหม — ต้อง uploadStatus:stored
 * **และ** approvalStatus:approved ทั้งคู่ (docs/13 §3.2) — ดู
 * `campaign.service.ts` validateFirmwarePayload() */
export const CAMPAIGN_ELIGIBLE_FIRMWARE_APPROVAL_STATUS: FirmwareApprovalStatus =
  'approved';

/** สถานะที่ QAEngineer ตัดสินใจ approve/reject ได้ (Stage ใหม่ — mirror
 * `APPROVABLE_CONFIG_STATUS`) — ต้องเป็น `pending_review` เท่านั้น กันไม่ให้กด
 * approve/reject ซ้ำหลังตัดสินใจไปแล้วครั้งหนึ่ง (ไม่มีการแก้ไฟล์เดิมซ้ำ
 * เหมือน Config ที่แก้ไม่ได้หลังส่งอนุมัติ — Firmware Engineer ต้องอัปโหลด
 * เวอร์ชันใหม่แทน) */
export const DECIDABLE_FIRMWARE_APPROVAL_STATUS: FirmwareApprovalStatus =
  'pending_review';
