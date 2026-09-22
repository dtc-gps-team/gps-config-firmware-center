import { apiJson } from "@/lib/api";

/**
 * Incident API client — `GET /incidents` (openapi `listIncidents`, tag
 * `incident`, schema `Incident`) · read-only rollout (Sprint 2) — ทุก Role
 * อ่านได้ (ไม่มี PermissionGuard จำกัด role) · Create ยังเป็นแค่ auto จาก
 * config-sync-writer เท่านั้น ไม่มี endpoint สร้าง/แก้ตรงๆ
 */

export type IncidentSeverity = "critical" | "high" | "medium" | "low";
export type IncidentStatus = "open" | "investigating" | "rolled_back" | "resolved";

export type Incident = {
  id: string;
  title: string;
  description: string | null;
  severity: IncidentSeverity;
  status: IncidentStatus;
  relatedConfigId: string | null;
  relatedFirmwareId: string | null;
  /** ต้นทางที่สร้าง (เช่น 'config-sync-writer') — null = สร้างมือ/ยังไม่ระบุ */
  source: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

/** filter ทุกตัว optional — ไม่ส่ง = ทุกรายการ เรียงตาม createdAt desc (backend) */
export function listIncidents(
  token: string,
  params?: {
    status?: IncidentStatus;
    relatedConfigId?: string;
    relatedFirmwareId?: string;
  },
): Promise<Incident[]> {
  const query = new URLSearchParams();
  if (params?.status) query.set("status", params.status);
  if (params?.relatedConfigId)
    query.set("relatedConfigId", params.relatedConfigId);
  if (params?.relatedFirmwareId)
    query.set("relatedFirmwareId", params.relatedFirmwareId);
  const qs = query.toString();
  return apiJson<Incident[]>(`/incidents${qs ? `?${qs}` : ""}`, { token });
}
