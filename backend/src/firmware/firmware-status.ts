import { FirmwareUploadStatus } from '@prisma/client';

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
