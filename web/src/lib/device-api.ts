import { apiJson } from "@/lib/api";
import type { CustomerSummary } from "@/lib/customer-api";

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
  /** รหัสรุ่นย่อย/hardware revision (เช่น "RevA") — มีมาตั้งแต่ issue #209
   * แต่ไม่เคยถูกเพิ่มเข้า type นี้จนถึงตอนนี้ (แก้ครั้งที่ 69) */
  hardwareRevisionCode: string | null;
  /** Identity group เพิ่มเติม (PDF §4.1, แก้ครั้งที่ 69) */
  imei: string | null;
  serialNumber: string | null;
  blackboxId: string | null;
  bootloader: string | null;
  status: DeviceStatus;
  registeredAt: string;
  installedAt: string | null;
  /** ลูกค้าที่ผูกไว้ (ถ้ามี) — null = ยังไม่ได้กำหนดลูกค้า (docs/12 เฟส B,
   * PR #127/#153) — read-only รอบนี้ ยังไม่มี endpoint กำหนด/แก้ */
  customer: CustomerSummary | null;
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

/** request body — `RegisterDeviceRequest` ใน openapi.yaml */
export type RegisterDeviceInput = {
  deviceId: string;
  simNumber: string;
  modelId: string;
  protocol: string;
  hardwareRevisionCode?: string;
  customerId?: string;
  imei?: string;
  serialNumber?: string;
  blackboxId?: string;
  bootloader?: string;
};

/** response — `RegisterDeviceResponse` (`Device` + `apiKey` จริงที่โชว์ได้
 * ครั้งเดียว ไม่มีทาง GET กลับมาดูซ้ำได้อีก) */
export type RegisterDeviceResult = Device & { apiKey: string };

/** `POST /devices` — Admin/SuperAdmin เท่านั้น (resource `device-registration`
 * action `Create`, issue #157 PR 1) · 409 ถ้า deviceId ซ้ำ, 404 ถ้า modelId/
 * customerId ไม่พบ, 400 ถ้า protocol ไม่อยู่ใน supportedProtocols ของรุ่นนั้น */
export function registerDevice(
  token: string,
  input: RegisterDeviceInput,
): Promise<RegisterDeviceResult> {
  return apiJson<RegisterDeviceResult>("/devices", {
    method: "POST",
    token,
    body: JSON.stringify(input),
  });
}
