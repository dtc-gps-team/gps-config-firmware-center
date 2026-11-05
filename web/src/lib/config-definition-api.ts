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
  /** ST override ค่า field นี้บนอุปกรณ์ผ่าน POST /config/{id}/override ได้ไหม
   * (issue #185) — OT ไม่มีสิทธิ์ override เลยไม่ว่าค่านี้จะเป็นอะไร */
  stOverridable: boolean;
  /** หมวดหมู่ field สำหรับจัดกลุ่มแสดงผล (เช่น "Network", "Server", "Security") */
  category: string | null;
  /** field เก็บค่าอ่อนไหว — ใช้ซ่อนค่าบนหน้าจอ */
  sensitive: boolean;
  /** ต้อง Restart กล่องหลังเปลี่ยนค่า field นี้ไหม */
  restartRequired: boolean;
  /** ค่าเริ่มต้นของ field นี้ (issue #202) — string ดิบ, parse ตาม dataType
   * ตอนใช้งานจริง (ConfigWizard auto-fill ตอนสร้าง Config ใหม่เท่านั้น) */
  defaultValue: string | null;
  /** ขอบเขตค่าต่ำสุด/สูงสุด (docs/30 §2 ข้อ 2) — ใช้ได้เฉพาะ dataType
   * integer/decimal เท่านั้น backend ปฏิเสธถ้าตั้งกับชนิดอื่น · `null` =
   * ไม่จำกัด */
  minValue: number | null;
  maxValue: number | null;
  supportedModels: ConfigFieldModelSupport[];
  /** `true` = field นี้ใช้ได้กับทุกรุ่นอุปกรณ์ — ไม่ต้องมี supportedModels เลย
   * ก็ได้ (ฟีดแบ็ก 2026-11-04) ดู `fieldSupportsModel()` ด้านล่าง */
  appliesToAllModels: boolean;
  createdAt: string;
  updatedAt: string;
};

/** field นี้ใช้ได้กับ `deviceModel`/`protocol` ที่ระบุไหม — จุดตรวจรวมจุดเดียว
 * mirror `fieldSupportsModel()` ฝั่ง backend (config-definition.service.ts)
 * ใช้แทนการ inline `supportedModels.some(...)` ทุกจุดที่ config-wizard.tsx
 * เคยทำ กันพลาดจุดใดจุดหนึ่งตอน appliesToAllModels เป็น true */
export function fieldSupportsModel(
  def: Pick<ConfigFieldDefinition, "appliesToAllModels" | "supportedModels">,
  deviceModel: string,
  protocol: string,
): boolean {
  return (
    def.appliesToAllModels ||
    def.supportedModels.some(
      (m) => m.deviceModel === deviceModel && m.protocol === protocol,
    )
  );
}

export function listConfigDefinitions(
  token: string,
): Promise<ConfigFieldDefinition[]> {
  return apiJson<ConfigFieldDefinition[]>("/config-definitions", { token });
}

/** request body — `CreateConfigDefinitionInput` ใน openapi.yaml
 * (`createConfigDefinition`) · ConfigEngineer เท่านั้น · `supportedModels` ต้องมี ≥ 1 คู่
 * เว้นแต่ `appliesToAllModels: true` (v3.83, ฟีดแบ็ก 2026-11-04) */
export type CreateConfigDefinitionInput = {
  fieldName: string;
  dataType: string;
  /** ว่าง = ไม่จำกัดค่า */
  allowedValues?: string[];
  required: boolean;
  /** `true` = รู้แค่ชื่อ + dataType ยังไม่รู้กฎครบ — default `false` */
  unknownSpec?: boolean;
  /** คำอธิบายความหมายของ field นี้ — บังคับกรอกตั้งแต่ v3.83 */
  description: string;
  /** หน่วยของค่า (เช่น "วินาที", "%") — ไม่บังคับ, maxLength 20 */
  unit?: string;
  /** ST override ค่า field นี้บนอุปกรณ์ได้ไหม (issue #185) — ไม่บังคับ
   * default false (override ไม่ได้เลยจนกว่าจะเปิดชัดเจน) */
  stOverridable?: boolean;
  /** หมวดหมู่ field (เช่น "Network", "Server", "Security") — ไม่บังคับ */
  category?: string;
  /** field เก็บค่าอ่อนไหว — ไม่บังคับ, default false */
  sensitive?: boolean;
  /** ต้อง Restart กล่องหลังเปลี่ยนค่า field นี้ไหม — ไม่บังคับ, default false */
  restartRequired?: boolean;
  /** ค่าเริ่มต้นของ field นี้ (issue #202) — ไม่บังคับ, maxLength 255 */
  defaultValue?: string;
  /** ขอบเขตค่าต่ำสุด/สูงสุด (docs/30 §2 ข้อ 2) — ไม่บังคับ ใช้ได้เฉพาะ dataType
   * integer/decimal เท่านั้น */
  minValue?: number;
  maxValue?: number;
  /** ต้องมี ≥ 1 คู่ เว้นแต่ appliesToAllModels: true */
  supportedModels?: ConfigFieldModelSupport[];
  /** `true` = field นี้ใช้ได้กับทุกรุ่นอุปกรณ์ ไม่ต้องส่ง supportedModels เลย
   * ก็ได้ (v3.83, ฟีดแบ็ก 2026-11-04) — ไม่บังคับ, default false */
  appliesToAllModels?: boolean;
};

export function createConfigDefinition(
  token: string,
  input: CreateConfigDefinitionInput,
): Promise<ConfigFieldDefinition> {
  return apiJson<ConfigFieldDefinition>("/config-definitions", {
    method: "POST",
    token,
    body: JSON.stringify(input),
  });
}

/** request body ของ `PATCH /config-definitions/{id}` - ส่งเฉพาะ field ที่แก้ · `fieldName` แก้ไม่ได้
 * · `null` ล้างค่าที่ไม่บังคับ (description/unit/category/defaultValue/minValue/maxValue) */
export type UpdateConfigDefinitionInput = {
  dataType?: string;
  allowedValues?: string[];
  required?: boolean;
  unknownSpec?: boolean;
  description?: string | null;
  unit?: string | null;
  stOverridable?: boolean;
  category?: string | null;
  sensitive?: boolean;
  restartRequired?: boolean;
  defaultValue?: string | null;
  minValue?: number | null;
  maxValue?: number | null;
  /** ส่งมา = แทนที่ทั้งชุด ต้องมี ≥ 1 คู่ เว้นแต่ค่าหลังแก้ของ
   * appliesToAllModels เป็น true */
  supportedModels?: ConfigFieldModelSupport[];
  /** (v3.83) `true` = field นี้ใช้ได้กับทุกรุ่นอุปกรณ์ */
  appliesToAllModels?: boolean;
};

/** `PATCH /config-definitions/{id}` - ConfigEngineer (และ SuperAdmin) · กฎ validate ที่เปลี่ยนมีผลกับ
 * Config ที่สร้าง/แก้ครั้งถัดไปเท่านั้น */
export function updateConfigDefinition(
  token: string,
  id: string,
  input: UpdateConfigDefinitionInput,
): Promise<ConfigFieldDefinition> {
  return apiJson<ConfigFieldDefinition>(`/config-definitions/${id}`, {
    method: "PATCH",
    token,
    body: JSON.stringify(input),
  });
}

/** `DELETE /config-definitions/{id}` - 409 ถ้ายังมี Config (ที่ไม่ถูกลบ) ใช้พารามิเตอร์นี้อยู่ */
export function deleteConfigDefinition(
  token: string,
  id: string,
): Promise<void> {
  return apiJson<void>(`/config-definitions/${id}`, {
    method: "DELETE",
    token,
  });
}

/** `GET /config-definitions/{id}/usage` - จำนวน Config ที่ใช้พารามิเตอร์นี้ + ตัวอย่างชื่อ (สูงสุด 5) */
export type ConfigDefinitionUsage = {
  count: number;
  configs: { id: string; name: string }[];
};

export function getConfigDefinitionUsage(
  token: string,
  id: string,
): Promise<ConfigDefinitionUsage> {
  return apiJson<ConfigDefinitionUsage>(`/config-definitions/${id}/usage`, {
    token,
  });
}

/** "GT06N/TCP, GT06L/TCP" หรือ "ทุกโมเดล" — ใช้โชว์ในตารางและเป็นค่าให้ filter
 * ข้อความ · รับ def ทั้งก้อนแทนแค่ `supportedModels` เพราะต้องรู้
 * `appliesToAllModels` ด้วย (v3.83) */
export function formatModelSupport(
  def: Pick<ConfigFieldDefinition, "supportedModels" | "appliesToAllModels">,
): string {
  if (def.appliesToAllModels) return "ทุกโมเดล";
  return def.supportedModels
    .map((m) => `${m.deviceModel}/${m.protocol}`)
    .join(", ");
}
