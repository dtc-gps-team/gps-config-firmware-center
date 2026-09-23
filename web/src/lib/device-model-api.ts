import { apiJson } from "@/lib/api";

/**
 * DeviceModel API client — ตรงกับ `docs/api/openapi.yaml` tag `device-model`
 * (issue #209, docs/15) — canonical registry ของรุ่นอุปกรณ์ + protocol ที่รองรับ
 * แทน string อิสระเดิม · **ยังไม่มีหน้าจัดการ (Admin CRUD) ใน Web** — เพิ่ม/แก้รุ่น
 * ผ่าน backend seed เท่านั้นตอนนี้ (mirror `customer-api.ts`)
 */

export type DeviceModelStatus = "active" | "discontinued";

export type DeviceModel = {
  id: string;
  name: string;
  manufacturer: string | null;
  supportedProtocols: string[];
  status: DeviceModelStatus;
  warrantyMonths: number | null;
  endOfSupportDate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

/** `GET /device-models` — ทุก Role ที่ login แล้วเรียกได้ (ไม่มี PermissionGuard,
 * mirror `GET /users`) · ใช้ทำ dropdown/checkbox เลือกรุ่นตอนสร้าง Parameter */
export function listDeviceModels(token: string): Promise<DeviceModel[]> {
  return apiJson<DeviceModel[]>("/device-models", { token });
}
