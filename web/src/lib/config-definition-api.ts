import { apiJson } from "@/lib/api";

/**
 * Config Definition Lookup API client — ตรงกับ `docs/api/openapi.yaml`
 * (`ConfigFieldDefinition` / `listConfigDefinitions`)
 *
 * คลัง field ที่ระบบรู้จัก ใช้อ้างอิงตอนกรอก/ตรวจ Config — wizard สร้าง/แก้ Config
 * filter ด้วย `supportedModels` เพื่อ render ช่องกรอกที่ถูกต้อง + โชว์ `unit`
 */

/** คู่ (deviceModel, protocol) หนึ่งคู่ที่ field นี้ใช้ได้ */
export type ConfigFieldModelSupport = {
  deviceModel: string;
  protocol: string;
};

/** response shape — `ConfigFieldDefinition` ใน openapi.yaml */
export type ConfigFieldDefinition = {
  id: string;
  fieldName: string;
  dataType: string;
  /** ค่าที่ยอมรับได้ (ว่าง = ไม่จำกัดค่า) */
  allowedValues: string[];
  required: boolean;
  /** field ที่รู้ว่ามีในระบบเดิม แต่ยังไม่มี spec ยืนยันชัดเจน */
  unknownSpec: boolean;
  description: string | null;
  /** หน่วยของค่า field (เช่น "วินาที", "%") — โชว์ข้างช่องกรอก ไม่ใช้ validate */
  unit: string | null;
  supportedModels: ConfigFieldModelSupport[];
  createdAt: string;
  updatedAt: string;
};

export function listConfigDefinitions(
  token: string,
): Promise<ConfigFieldDefinition[]> {
  return apiJson<ConfigFieldDefinition[]>("/config-definitions", { token });
}

/** "GT06N/TCP, GT06L/TCP" — ใช้โชว์ในตารางและเป็นค่าให้ filter ข้อความ */
export function formatModelSupport(
  models: ConfigFieldModelSupport[],
): string {
  return models
    .map((m) => `${m.deviceModel}/${m.protocol}`)
    .join(", ");
}
