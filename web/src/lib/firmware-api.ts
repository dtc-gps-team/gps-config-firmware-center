import { apiJson } from "@/lib/api";

/**
 * Firmware API client — ตรงกับ `docs/api/openapi.yaml` tag `firmware`
 * (schema `Firmware`) · Sprint 3 #23 (PR #151) — รอบนี้ทำแค่ `listFirmware`
 * (ใช้เป็น dropdown เลือก payload ใน Campaign Wizard) ยังไม่ทำ
 * upload/compatibility-tag/simulate ฝั่งเว็บ (เก็บไว้ทำหน้า Firmware
 * Repository เต็มรูปแบบทีหลัง)
 */

export const FIRMWARE_UPLOAD_STATUSES = ["pending", "stored", "failed"] as const;

export type FirmwareUploadStatus = (typeof FIRMWARE_UPLOAD_STATUSES)[number];

/** response shape — `Firmware` ใน openapi.yaml */
export type Firmware = {
  id: string;
  version: string;
  deviceModelCompatibility: string[];
  uploadStatus: FirmwareUploadStatus;
  deviceUpdateStatus: "unknown" | "up_to_date" | "pending_update";
  objectKey: string;
  originalFilename: string;
  fileSizeBytes: number;
  uploadedBy: string;
  uploadedAt: string;
};

/** `GET /firmware` — ทุก role อ่านได้ ไม่มี filter/paging ในรอบนี้ (จำนวน
 * Firmware ใน MVP น้อย — mirror `listDevices`/`listConfigs`) */
export function listFirmware(token: string): Promise<Firmware[]> {
  return apiJson<Firmware[]>("/firmware", { token });
}
