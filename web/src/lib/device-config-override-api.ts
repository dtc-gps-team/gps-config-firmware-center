import { apiJson } from "@/lib/api";

/**
 * Per-device Config Override API client — ตรงกับ `docs/api/openapi.yaml`
 * schema `DeviceConfigOverride` (issue #223, มติ 2026-09-24, PR #225) — ST
 * ส่งคำขอผ่าน Mobile (`overrideDeviceConfig`) หน้านี้เป็นแค่คิวอนุมัติของ
 * Operation (`listDeviceConfigOverrides`/`approve`/`reject`) เท่านั้น
 */

export const DEVICE_CONFIG_OVERRIDE_STATUSES = [
  "pending",
  "approved",
  "rejected",
] as const;

export type DeviceConfigOverrideStatus =
  (typeof DEVICE_CONFIG_OVERRIDE_STATUSES)[number];

export type DeviceConfigOverride = {
  id: string;
  deviceId: string;
  configId: string;
  /** นับจากทุกสถานะ (รวม rejected) เพิ่มทีละ 1 ต่ออุปกรณ์ */
  versionNumber: number;
  /** สถานะ override สะสมของอุปกรณ์เครื่องนี้ ณ version นี้ */
  fields: Record<string, unknown>;
  reason: string;
  status: DeviceConfigOverrideStatus;
  /** user id ของ ST ที่ส่งคำขอ */
  overriddenBy: string;
  overriddenAt: string;
  /** user id ของ Operation ที่อนุมัติ/ปฏิเสธ — null ถ้ายัง pending */
  decidedBy: string | null;
  decidedAt: string | null;
  rejectReason: string | null;
};

/** `GET /device-config-overrides` — คิวของ Operation เรียงใหม่สุดก่อน
 * `status` ไม่ระบุ = คืนทุกสถานะ */
export function listDeviceConfigOverrides(
  token: string,
  params?: { status?: DeviceConfigOverrideStatus },
): Promise<DeviceConfigOverride[]> {
  const query = params?.status
    ? `?status=${encodeURIComponent(params.status)}`
    : "";
  return apiJson<DeviceConfigOverride[]>(
    `/device-config-overrides${query}`,
    { token },
  );
}

/** `POST /device-config-overrides/{id}/approve` — เปลี่ยนเป็น `approved`
 * เท่านั้น ไม่ apply เข้าอุปกรณ์อัตโนมัติ ช่างต้องกด apply-config เองอีกครั้ง */
export function approveDeviceConfigOverride(
  token: string,
  id: string,
): Promise<DeviceConfigOverride> {
  return apiJson<DeviceConfigOverride>(
    `/device-config-overrides/${id}/approve`,
    { method: "POST", token },
  );
}

/** `POST /device-config-overrides/{id}/reject` — `rejectReason` ไม่บังคับ */
export function rejectDeviceConfigOverride(
  token: string,
  id: string,
  body?: { rejectReason?: string },
): Promise<DeviceConfigOverride> {
  return apiJson<DeviceConfigOverride>(
    `/device-config-overrides/${id}/reject`,
    {
      method: "POST",
      token,
      body: body?.rejectReason ? JSON.stringify(body) : undefined,
    },
  );
}
