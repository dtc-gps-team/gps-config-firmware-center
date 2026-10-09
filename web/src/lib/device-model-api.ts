import { apiJson } from "@/lib/api";

/**
 * DeviceModel API client — ตรงกับ `docs/api/openapi.yaml` tag `device-model`
 * (issue #209, docs/15) — canonical registry ของรุ่นอุปกรณ์ + protocol ที่รองรับ
 * แทน string อิสระเดิม · หน้าจัดการ (Admin/SuperAdmin CRUD) อยู่ที่ `/device-models`
 * (`createDeviceModel`/`updateDeviceModel` ด้านล่าง)
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

/** request body — `CreateDeviceModelInput` ใน openapi.yaml */
export type CreateDeviceModelInput = {
  name: string;
  manufacturer?: string;
  supportedProtocols: string[];
  status?: DeviceModelStatus;
  warrantyMonths?: number;
  endOfSupportDate?: string;
  notes?: string;
};

/** `POST /device-models` — Admin/SuperAdmin เท่านั้น · 409 ถ้าชื่อรุ่นซ้ำ */
export function createDeviceModel(
  token: string,
  input: CreateDeviceModelInput,
): Promise<DeviceModel> {
  return apiJson<DeviceModel>("/device-models", {
    method: "POST",
    token,
    body: JSON.stringify(input),
  });
}

/** request body — `UpdateDeviceModelInput` ใน openapi.yaml (ทุก field optional,
 * ไม่มี `name` ให้แก้) */
export type UpdateDeviceModelInput = {
  manufacturer?: string;
  supportedProtocols?: string[];
  status?: DeviceModelStatus;
  warrantyMonths?: number;
  endOfSupportDate?: string;
  notes?: string;
};

/** `PATCH /device-models/{id}` — Admin/SuperAdmin เท่านั้น · ไม่มี hard delete
 * ใช้ `status: discontinued` แทน */
export function updateDeviceModel(
  token: string,
  id: string,
  input: UpdateDeviceModelInput,
): Promise<DeviceModel> {
  return apiJson<DeviceModel>(`/device-models/${id}`, {
    method: "PATCH",
    token,
    body: JSON.stringify(input),
  });
}
