import { apiJson } from "@/lib/api";

/**
 * Device API client — ตรงกับ `docs/api/openapi.yaml` tag `device`
 * (`listDevices` / `getDevice` / schema `Device`)
 */

export const DEVICE_STATUSES = [
  "registered",
  "installed",
  "decommissioned",
] as const;

export type DeviceStatus = (typeof DEVICE_STATUSES)[number];

/** response shape — `Device` ใน openapi.yaml (ตรงกับ Prisma model Device) */
export type Device = {
  /** surrogate key ภายใน — client อ้างอิงด้วย deviceId */
  id: string;
  /** เลขเครื่องจริงที่ช่างกรอก/สแกนตอนลงทะเบียน (unique) */
  deviceId: string;
  simNumber: string;
  deviceModel: string;
  protocol: string;
  status: DeviceStatus;
  registeredAt: string;
  installedAt: string | null;
};

export type ListDevicesParams = {
  search?: string;
  deviceModel?: string;
  protocol?: string;
  status?: DeviceStatus;
};

/**
 * `GET /devices` — ทุก filter optional · ตอนนี้ UI กรอง/ค้นหาฝั่ง client
 * (UI standard — planning/01 §3) จึงมักเรียกแบบไม่ส่ง params · เก็บ params
 * ไว้ให้สลับเป็น server-side ได้ภายหลังโดยไม่ต้องแก้ signature
 */
export function listDevices(
  token: string,
  params?: ListDevicesParams,
): Promise<Device[]> {
  const qs = new URLSearchParams();
  if (params?.search) qs.set("search", params.search);
  if (params?.deviceModel) qs.set("deviceModel", params.deviceModel);
  if (params?.protocol) qs.set("protocol", params.protocol);
  if (params?.status) qs.set("status", params.status);
  const query = qs.toString();
  return apiJson<Device[]>(`/devices${query ? `?${query}` : ""}`, { token });
}

/** `GET /devices/{deviceId}` — key ด้วยเลขเครื่องจริง · 404 ถ้าไม่พบ */
export function getDevice(token: string, deviceId: string): Promise<Device> {
  return apiJson<Device>(`/devices/${encodeURIComponent(deviceId)}`, { token });
}
