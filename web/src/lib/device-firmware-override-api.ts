import { apiJson } from "@/lib/api";

/**
 * Firmware Override รายเครื่อง API client — ตรงกับ `docs/api/openapi.yaml`
 * schema `DeviceFirmwareOverride` (Sprint 3 แถวที่ 24) — mirror
 * `device-config-override-api.ts` ทุกประการ ต่างกันแค่ไม่มี `fields`/
 * `configId` เพราะ Firmware เป็นเวอร์ชันเดียวทั้งก้อน ไม่ใช่ key-value แบบ
 * Config — ST ส่งคำขอผ่าน Mobile (`overrideDeviceFirmware`, ยังไม่ implement
 * ฝั่ง Mobile รอบนี้) หน้านี้เป็นแค่คิวอนุมัติของ Operation
 * (`listDeviceFirmwareOverrides`/`approve`/`reject`) เท่านั้น
 */

export const DEVICE_FIRMWARE_OVERRIDE_STATUSES = [
  "pending",
  "approved",
  "rejected",
] as const;

export type DeviceFirmwareOverrideStatus =
  (typeof DEVICE_FIRMWARE_OVERRIDE_STATUSES)[number];

export type DeviceFirmwareOverride = {
  id: string;
  deviceId: string;
  firmwareId: string;
  /** นับจากทุกสถานะ (รวม rejected) เพิ่มทีละ 1 ต่ออุปกรณ์ */
  versionNumber: number;
  reason: string;
  status: DeviceFirmwareOverrideStatus;
  /** user id ของ ST ที่ส่งคำขอ */
  overriddenBy: string;
  overriddenAt: string;
  /** user id ของ Operation ที่อนุมัติ/ปฏิเสธ — null ถ้ายัง pending */
  decidedBy: string | null;
  decidedAt: string | null;
  rejectReason: string | null;
};

/** `GET /device-firmware-overrides` — คิวของ Operation เรียงใหม่สุดก่อน
 * `status` ไม่ระบุ = คืนทุกสถานะ */
export function listDeviceFirmwareOverrides(
  token: string,
  params?: { status?: DeviceFirmwareOverrideStatus },
): Promise<DeviceFirmwareOverride[]> {
  const query = params?.status
    ? `?status=${encodeURIComponent(params.status)}`
    : "";
  return apiJson<DeviceFirmwareOverride[]>(
    `/device-firmware-overrides${query}`,
    { token },
  );
}

/** `POST /device-firmware-overrides/{id}/approve` — เปลี่ยนเป็น `approved`
 * เท่านั้น ปลดล็อกให้ `confirmFirmwareInstall` ยอมรับ firmware นี้กับ
 * อุปกรณ์เครื่องนี้ได้ ไม่ apply เข้าอุปกรณ์อัตโนมัติ */
export function approveDeviceFirmwareOverride(
  token: string,
  id: string,
): Promise<DeviceFirmwareOverride> {
  return apiJson<DeviceFirmwareOverride>(
    `/device-firmware-overrides/${id}/approve`,
    { method: "POST", token },
  );
}

/** `POST /device-firmware-overrides/{id}/reject` — `rejectReason` ไม่บังคับ */
export function rejectDeviceFirmwareOverride(
  token: string,
  id: string,
  body?: { rejectReason?: string },
): Promise<DeviceFirmwareOverride> {
  return apiJson<DeviceFirmwareOverride>(
    `/device-firmware-overrides/${id}/reject`,
    {
      method: "POST",
      token,
      body: body?.rejectReason ? JSON.stringify(body) : undefined,
    },
  );
}
