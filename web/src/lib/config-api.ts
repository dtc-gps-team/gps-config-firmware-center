import { apiJson } from "@/lib/api";

/**
 * Config API client — ตรงกับ `docs/api/openapi.yaml` tag `config`
 * (`DeviceConfigDraft` / `ConfigWriteInput`)
 */

export const CONFIG_STATUSES = [
  "draft",
  "testing",
  "approved",
  "rejected",
  "synced",
] as const;

export type ConfigStatus = (typeof CONFIG_STATUSES)[number];

/** response shape — `DeviceConfigDraft` ใน openapi.yaml */
export type Config = {
  id: string;
  /** ชื่อ Config ที่ผู้ใช้ตั้ง — unique ทั้งระบบ (มติ Sprint 1 review ข้อ 4) */
  name: string;
  deviceModel: string;
  protocol: string;
  /** คำอธิบายสั้นๆ ว่า Config ชุดนี้ทำไว้เพื่ออะไร (ไม่บังคับ) */
  description: string | null;
  status: ConfigStatus;
  fields: Record<string, unknown>;
  createdBy: string;
  approvedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

/** snapshot ของ Config ตอน Operation approve — `ConfigVersion` ใน openapi.yaml
 * (append-only · ว่าง = ยังไม่เคยถูก approve) */
export type ConfigVersion = {
  id: string;
  configId: string;
  versionNumber: number;
  deviceModel: string;
  protocol: string;
  fields: Record<string, unknown>;
  approvedBy: string;
  approvedAt: string;
};

/** request body — `ConfigWriteInput` ใน openapi.yaml (createConfig ส่งครบทุก field) */
export type ConfigWriteInput = {
  name: string;
  deviceModel: string;
  protocol: string;
  fields: Record<string, unknown>;
  /** ไม่บังคับ · ส่ง "" เพื่อล้างค่าตอน update */
  description?: string;
};

export function listConfigs(
  token: string,
  params?: { status?: ConfigStatus },
): Promise<Config[]> {
  const query = params?.status ? `?status=${encodeURIComponent(params.status)}` : "";
  return apiJson<Config[]>(`/config${query}`, { token });
}

export function getConfig(token: string, id: string): Promise<Config> {
  return apiJson<Config>(`/config/${id}`, { token });
}

/** ประวัติเวอร์ชัน (snapshot ตอน approve) — เรียงล่าสุดก่อน · [] = ยังไม่เคย approve */
export function listConfigVersions(
  token: string,
  id: string,
): Promise<ConfigVersion[]> {
  return apiJson<ConfigVersion[]>(`/config/${id}/versions`, { token });
}

export function createConfig(
  token: string,
  input: ConfigWriteInput,
): Promise<Config> {
  return apiJson<Config>("/config", {
    method: "POST",
    token,
    body: JSON.stringify(input),
  });
}

export function updateConfig(
  token: string,
  id: string,
  input: Partial<ConfigWriteInput>,
): Promise<Config> {
  return apiJson<Config>(`/config/${id}`, {
    method: "PUT",
    token,
    body: JSON.stringify(input),
  });
}

export function deleteConfig(token: string, id: string): Promise<void> {
  return apiJson<void>(`/config/${id}`, { method: "DELETE", token });
}
