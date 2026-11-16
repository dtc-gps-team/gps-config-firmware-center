import { apiJson } from "@/lib/api";
import type { CustomerSummary } from "@/lib/customer-api";
import type { DeviceFirmwareOverride } from "@/lib/device-firmware-override-api";

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
  /** `DeviceModel.id` ของเครื่อง (openapi v3.99) — ใช้กรองเครื่องตามรุ่นของ Campaign */
  modelId: string;
  deviceModel: string;
  protocol: string;
  /** รหัสรุ่นย่อย/hardware revision (เช่น "RevA") — มีมาตั้งแต่ issue #209
   * แต่ไม่เคยถูกเพิ่มเข้า type นี้จนถึงตอนนี้ (แก้ครั้งที่ 69) */
  hardwareRevisionCode: string | null;
  /** Identity group เพิ่มเติม (PDF §4.1, แก้ครั้งที่ 69) */
  imei: string | null;
  serialNumber: string | null;
  blackboxId: string | null;
  status: DeviceStatus;
  registeredAt: string;
  installedAt: string | null;
  /** ปลดระวาง (มติ A 2026-11-05): เวลา + เหตุผลที่ Admin กรอก — null ทั้งคู่เมื่อไม่ได้ปลดระวาง */
  decommissionedAt: string | null;
  decommissionReason: string | null;
  /** ลูกค้าที่ผูกไว้ (ถ้ามี) — null = ยังไม่ได้กำหนดลูกค้า (docs/12 เฟส B,
   * PR #127/#153) · แก้ได้ผ่าน `updateDevice` (Admin/SuperAdmin) */
  customer: CustomerSummary | null;
};

export type ListDevicesParams = {
  search?: string;
  deviceModel?: string;
  protocol?: string;
  status?: DeviceStatus;
  /** เครื่องที่ปลดระวางแล้วซ่อนเป็นค่าเริ่มต้น — `true` = รวมไว้ด้วย (ระบุ `status=decommissioned` ก็เห็น) */
  includeDecommissioned?: boolean;
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
  if (params?.includeDecommissioned) qs.set("includeDecommissioned", "true");
  const query = qs.toString();
  return apiJson<Device[]>(`/devices${query ? `?${query}` : ""}`, { token });
}

/** `GET /devices/{deviceId}` — key ด้วยเลขเครื่องจริง · 404 ถ้าไม่พบ */
export function getDevice(token: string, deviceId: string): Promise<Device> {
  return apiJson<Device>(`/devices/${encodeURIComponent(deviceId)}`, { token });
}

/** สถานะ Config/Firmware ของอุปกรณ์เทียบกับ Rollout ล่าสุด — `DeviceStatus`
 * ใน openapi.yaml (`configStatus`/`firmwareStatus`) · ชื่อ type ต่างจาก
 * `DeviceStatus` ข้างบน (นั่นคือสถานะ lifecycle registered/installed/...) */
export const DEVICE_PAYLOAD_STATUSES = [
  "up_to_date",
  "pending",
  "failed",
  "unknown",
] as const;
export type DevicePayloadStatus = (typeof DEVICE_PAYLOAD_STATUSES)[number];

/** response ของ `GET /devices/{deviceId}/status` (`DeviceStatus` ใน
 * openapi.yaml) — คำนวณจาก `CampaignRolloutTarget` ล่าสุดของเครื่องนี้ ไม่ได้
 * อ่านค่าจากกล่องจริง · `lastCheckInMessage` เป็น null เสมอตอนนี้ (ยังไม่มี
 * concept check-in) เว็บจึงไม่แสดง */
export type DeviceStatusInfo = {
  deviceId: string;
  configStatus: DevicePayloadStatus;
  firmwareStatus: DevicePayloadStatus;
  /** มีค่าเฉพาะตอนสถานะเป็น `pending` */
  configRolloutId: string | null;
  firmwareRolloutId: string | null;
  lastCheckInMessage: string | null;
  /** คำขอ Firmware Override ที่ยังรออนุมัติของเครื่องนี้ (null = ไม่มี) */
  pendingFirmwareOverride: DeviceFirmwareOverride | null;
};

/** `GET /devices/{deviceId}/status` — ทุก Role ที่อ่านอุปกรณ์ได้ */
export function getDeviceStatus(
  token: string,
  deviceId: string,
): Promise<DeviceStatusInfo> {
  return apiJson<DeviceStatusInfo>(
    `/devices/${encodeURIComponent(deviceId)}/status`,
    { token },
  );
}

/** request body — `RegisterDeviceRequest` ใน openapi.yaml */
export type RegisterDeviceInput = {
  deviceId: string;
  simNumber: string;
  modelId: string;
  protocol: string;
  hardwareRevisionCode?: string;
  customerId?: string;
  imei: string;
  serialNumber: string;
  blackboxId: string;
};

/** response — `RegisterDeviceResponse` (`Device` + `apiKey` จริงที่โชว์ได้
 * ครั้งเดียว ไม่มีทาง GET กลับมาดูซ้ำได้อีก) */
export type RegisterDeviceResult = Device & { apiKey: string };

/** `POST /devices/{deviceId}/rotate-key` — Admin/SuperAdmin เท่านั้น ออก
 * API key ใหม่ (key เก่าใช้ไม่ได้ทันที) · apiKey ใน response โชว์ได้ครั้งเดียว */
export function rotateDeviceKey(
  token: string,
  deviceId: string,
): Promise<RegisterDeviceResult> {
  return apiJson<RegisterDeviceResult>(
    `/devices/${encodeURIComponent(deviceId)}/rotate-key`,
    { method: "POST", token },
  );
}

/** `POST /devices/{deviceId}/confirm-install` — Admin/SuperAdmin เท่านั้น ยืนยัน
 * ว่าติดตั้งแล้ว ย้าย status `registered` -> `installed` (409 ถ้าสถานะไม่ใช่
 * `registered`) — ต้อง `installed` ถึงจะเพิ่มเข้า Campaign ได้ */
export function confirmDeviceInstalled(
  token: string,
  deviceId: string,
): Promise<Device> {
  return apiJson<Device>(
    `/devices/${encodeURIComponent(deviceId)}/confirm-install`,
    { method: "POST", token },
  );
}

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

/** request body ของ `PATCH /devices/{deviceId}` — ส่งเฉพาะ field ที่เปลี่ยน · Device ID/โมเดล/โปรโตคอลแก้ไม่ได้
 * · IMEI/Serial/Blackbox/SIM ล้างค่าไม่ได้ · `hardwareRevisionCode` ส่งค่าว่างเพื่อล้าง · `customerId`
 * ต้องเป็นลูกค้าที่ใช้งานอยู่ */
export type UpdateDeviceInput = {
  simNumber?: string;
  customerId?: string;
  hardwareRevisionCode?: string | null;
  imei?: string;
  serialNumber?: string;
  blackboxId?: string;
};

/** `PATCH /devices/{deviceId}` — Admin/SuperAdmin เท่านั้น · 409 ถ้าเครื่องปลดระวางแล้ว, IMEI/Serial/
 * Blackbox ซ้ำกับเครื่องอื่น (รวมที่ปลดระวางแล้ว), SIM ซ้ำกับเครื่องที่ใช้งานอยู่ หรือลูกค้าปิดใช้งานอยู่ */
export function updateDevice(
  token: string,
  deviceId: string,
  input: UpdateDeviceInput,
): Promise<Device> {
  return apiJson<Device>(`/devices/${encodeURIComponent(deviceId)}`, {
    method: "PATCH",
    token,
    body: JSON.stringify(input),
  });
}

/** `POST /devices/{deviceId}/decommission` — Admin/SuperAdmin เท่านั้น · เหตุผลบังคับ · ล้าง API key ทันที ·
 * 409 พร้อมจำนวนต่อชนิดถ้ายังมีงานค้าง (คำขอส่งเข้ากล่อง/Rollout เปิดอยู่/Task/Override ที่รออนุมัติ) */
export function decommissionDevice(
  token: string,
  deviceId: string,
  reason: string,
): Promise<Device> {
  return apiJson<Device>(
    `/devices/${encodeURIComponent(deviceId)}/decommission`,
    { method: "POST", token, body: JSON.stringify({ reason }) },
  );
}

/** `POST /devices/{deviceId}/reactivate` — Admin/SuperAdmin เท่านั้น · กลับเป็น `registered` + API key ใหม่
 * (โชว์ได้ครั้งเดียว) · 409 ถ้า SIM เดิมถูกเครื่องอื่นที่ใช้งานอยู่ใช้ไปแล้ว ให้ส่ง `simNumber` ใหม่ */
export function reactivateDevice(
  token: string,
  deviceId: string,
  input?: { simNumber?: string },
): Promise<RegisterDeviceResult> {
  return apiJson<RegisterDeviceResult>(
    `/devices/${encodeURIComponent(deviceId)}/reactivate`,
    { method: "POST", token, body: JSON.stringify(input ?? {}) },
  );
}
