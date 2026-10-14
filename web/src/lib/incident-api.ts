import { apiJson } from "@/lib/api";

/**
 * Incident API client — `GET /incidents` (openapi `listIncidents`, tag
 * `incident`, schema `Incident`) · read-only rollout (Sprint 2) — ทุก Role
 * อ่านได้ (ไม่มี PermissionGuard จำกัด role) · Create ยังเป็นแค่ auto จาก
 * config-sync-writer เท่านั้น ไม่มี endpoint สร้าง/แก้ตรงๆ
 */

export type IncidentSeverity = "critical" | "high" | "medium" | "low";
export type IncidentStatus =
  | "open"
  | "investigating"
  | "rolled_back"
  | "resolved"
  // Operation ตัดสินว่า Field Report ไม่ใช่ปัญหาจริง/แจ้งซ้ำ (issue #236)
  | "dismissed";

export type Incident = {
  id: string;
  title: string;
  description: string | null;
  severity: IncidentSeverity;
  status: IncidentStatus;
  relatedConfigId: string | null;
  relatedFirmwareId: string | null;
  /** ต้นทางที่สร้าง (เช่น 'config-sync-writer', 'field-report') — null =
   * สร้างมือ/ยังไม่ระบุ */
  source: string | null;
  metadata: Record<string, unknown> | null;
  /** อุปกรณ์ที่ช่างรายงาน (เฉพาะ Field Report) */
  deviceId: string | null;
  /** user id ของช่างผู้แจ้ง (เฉพาะ Field Report) */
  reportedBy: string | null;
  /** user id ของ Operation ที่ตัดสินใจ และเวลา/หมายเหตุ — null จนกว่าจะตัดสินใจ */
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
  updatedAt: string;
};

/** `source` ของ Field Report ที่ช่างแจ้งจากมือถือ (issue #236) */
export const FIELD_REPORT_SOURCE = "field-report";

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

export function getIncident(token: string, id: string): Promise<Incident> {
  return apiJson<Incident>(`/incidents/${encodeURIComponent(id)}`, { token });
}

/** ทางเลือกของ `POST /incidents/{id}/decide` (openapi `DecideIncidentInput`) */
export const INCIDENT_DECISION_OUTCOMES = [
  "resolve",
  "dismiss",
  "promote",
] as const;
export type IncidentDecisionOutcome =
  (typeof INCIDENT_DECISION_OUTCOMES)[number];

/** ผลของ decide — `Incident` ที่อัปเดตแล้ว + `device` (มีค่าเฉพาะ promote ที่
 * อุปกรณ์ยังมีอยู่จริง) */
export type IncidentDecisionResult = Incident & {
  device: { deviceId: string; deviceModel: string; protocol: string } | null;
};

/**
 * `POST /incidents/{id}/decide` — Operation เท่านั้น (resource `incidents`
 * action `Approve`) · ใช้ได้กับ Field Report ที่ยัง `open` (404 ถ้าไม่ใช่
 * field report, 409 ถ้าตัดสินใจไปแล้ว) · `note` บังคับกรอก 1 ถึง 1000 ตัวอักษร
 */
export function decideIncident(
  token: string,
  id: string,
  input: { outcome: IncidentDecisionOutcome; note: string },
): Promise<IncidentDecisionResult> {
  return apiJson<IncidentDecisionResult>(
    `/incidents/${encodeURIComponent(id)}/decide`,
    { method: "POST", token, body: JSON.stringify(input) },
  );
}

