import { apiJson } from "@/lib/api";

/**
 * Firmware API client — ตรงกับ `docs/api/openapi.yaml` tag `firmware`
 * (schema `Firmware`) · Sprint 3 #23 (Firmware Repository, PR #151 backend)
 *
 * **หมายเหตุ cross-PR:** ไฟล์นี้มีอยู่แล้วแบบย่อ (แค่ `listFirmware`) บน branch
 * `feat/web-campaign-wizard` (PR #150 — ใช้ทำ dropdown เลือก payload ใน
 * Campaign Wizard เท่านั้น) — ตอน merge อาจชนกัน ให้ยึดเวอร์ชันนี้ (ครบกว่า
 * เป็น superset ของของเดิม) แล้วเอา field/ฟังก์ชันที่ Campaign Wizard branch
 * เพิ่มมาทีหลัง (ถ้ามี) มารวมด้วย
 */

export const FIRMWARE_UPLOAD_STATUSES = ["pending", "stored", "failed"] as const;

export type FirmwareUploadStatus = (typeof FIRMWARE_UPLOAD_STATUSES)[number];

export const FIRMWARE_DEVICE_UPDATE_STATUSES = [
  "unknown",
  "up_to_date",
  "pending_update",
] as const;

export type FirmwareDeviceUpdateStatus =
  (typeof FIRMWARE_DEVICE_UPDATE_STATUSES)[number];

/** Firmware Approval Lifecycle (docs/13_Role_Redesign_Proposal.md §3.2) — คนละ
 * มิติกับ uploadStatus (ผลทางเทคนิคของการอัปโหลดไฟล์ ไม่ใช่การตัดสินใจเรื่อง
 * คุณภาพ) */
export const FIRMWARE_APPROVAL_STATUSES = [
  "pending_review",
  "approved",
  "rejected",
] as const;

export type FirmwareApprovalStatus =
  (typeof FIRMWARE_APPROVAL_STATUSES)[number];

/** response shape — `Firmware` ใน openapi.yaml */
export type Firmware = {
  id: string;
  version: string;
  deviceModelCompatibility: string[];
  uploadStatus: FirmwareUploadStatus;
  deviceUpdateStatus: FirmwareDeviceUpdateStatus;
  objectKey: string;
  originalFilename: string;
  fileSizeBytes: number;
  uploadedBy: string;
  uploadedAt: string;
  approvalStatus: FirmwareApprovalStatus;
  approvedBy: string | null;
};

/** ผลทดสอบจาก Device Simulator — schema `SimulationResult` ใน openapi.yaml
 * (ตัวเดียวกับที่ `config-api.ts` ใช้ — ประกาศซ้ำในไฟล์นี้โดยตั้งใจ mirror
 * แพทเทิร์น `ActingUser` ฝั่ง backend ที่แต่ละ module ประกาศ type ซ้ำกันเอง
 * ไม่ import ข้ามโมดูล) */
export type SimulationResult = {
  passed: boolean;
  details: string[];
};

/** `GET /firmware` — ทุก role อ่านได้ ไม่มี filter/paging ในรอบนี้ (จำนวน
 * Firmware ใน MVP น้อย — mirror `listDevices`/`listConfigs`) */
export function listFirmware(token: string): Promise<Firmware[]> {
  return apiJson<Firmware[]>("/firmware", { token });
}

/** `GET /firmware/{firmwareId}` — เหมือน `listFirmware` สิทธิ์เดียวกัน · 404 ถ้าไม่พบ */
export function getFirmware(token: string, id: string): Promise<Firmware> {
  return apiJson<Firmware>(`/firmware/${id}`, { token });
}

/**
 * `POST /firmware` — FirmwareEngineer เท่านั้น · อัปโหลดไฟล์ขึ้น Object Storage จริง
 * (synchronous) · `deviceModel` เดี่ยวตอนนี้กลายเป็น compatibility tag
 * เริ่มต้น (1 รุ่น) แก้/เพิ่มทีหลังผ่าน `updateFirmwareCompatibility`
 * แยกต่างหาก · ขนาดไฟล์สูงสุด 50MB (backend บังคับ, client เช็คก่อนด้วย)
 */
export function uploadFirmware(
  token: string,
  input: { file: File; version: string; deviceModel: string },
): Promise<Firmware> {
  const form = new FormData();
  form.append("file", input.file);
  form.append("version", input.version);
  form.append("deviceModel", input.deviceModel);
  return apiJson<Firmware>("/firmware", {
    method: "POST",
    token,
    body: form,
  });
}

/**
 * `PATCH /firmware/{firmwareId}` — FirmwareEngineer เท่านั้น · แทนที่ `deviceModelCompatibility`
 * ทั้ง array เสมอ (ไม่ merge กับของเดิม) — ผู้เรียกต้องส่งรายการเต็มเสมอ
 */
export function updateFirmwareCompatibility(
  token: string,
  id: string,
  deviceModelCompatibility: string[],
): Promise<Firmware> {
  return apiJson<Firmware>(`/firmware/${id}`, {
    method: "PATCH",
    token,
    body: JSON.stringify({ deviceModelCompatibility }),
  });
}

/**
 * `POST /firmware/{firmwareId}/simulate` — FirmwareEngineer/QAEngineer/Operation/ST/OT · mock เช็คว่า
 * `deviceModel` ที่ระบุอยู่ใน `deviceModelCompatibility` ไหม · 409 ถ้า
 * `uploadStatus` ยังไม่ `stored`
 */
export function simulateFirmware(
  token: string,
  id: string,
  deviceModel: string,
): Promise<SimulationResult> {
  return apiJson<SimulationResult>(`/firmware/${id}/simulate`, {
    method: "POST",
    token,
    body: JSON.stringify({ deviceModel }),
  });
}

/**
 * `POST /firmware/{firmwareId}/approve` — QAEngineer อนุมัติคุณภาพ Firmware
 * สถานะ `pending_review` → `approved` (resource `firmware-decision`) ·
 * ใช้ใน Campaign ได้ต่อเมื่อ uploadStatus:stored **และ** approvalStatus:approved
 */
export function approveFirmware(token: string, id: string): Promise<Firmware> {
  return apiJson<Firmware>(`/firmware/${id}/approve`, {
    method: "POST",
    token,
  });
}

/**
 * `POST /firmware/{firmwareId}/reject` — QAEngineer ปฏิเสธคุณภาพ Firmware
 * สถานะ `pending_review` → `rejected` · ไม่มี body (เหมือน `rejectConfig`)
 * FirmwareEngineer ต้องอัปโหลดเวอร์ชันใหม่แก้ไข ไม่มีการแก้ไฟล์เดิมซ้ำ
 */
export function rejectFirmware(token: string, id: string): Promise<Firmware> {
  return apiJson<Firmware>(`/firmware/${id}/reject`, {
    method: "POST",
    token,
  });
}
