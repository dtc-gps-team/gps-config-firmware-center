import { apiJson } from "@/lib/api";

/**
 * คำขอส่ง Config/Firmware เข้ากล่องจากหน้างาน (docs/25 §3.3–§3.4 · docs/27 B2
 * · docs/30 P1) — ST/OT ส่งคำขอผ่าน Mobile หน้านี้เป็นแค่คิวอนุมัติของ
 * Operation (`listFieldApplyRequests`/`approve`/`reject`) เท่านั้น ตรงกับ
 * `docs/api/openapi.yaml` schema `ConfigApplyRequestQueueItem`
 */

export const FIELD_APPLY_REQUEST_STATUSES = [
  "pending",
  "approved",
  "sending",
  "succeeded",
  "failed",
  "skipped_offline",
  "rejected",
  "cancelled",
  "expired",
] as const;

export type FieldApplyRequestStatus =
  (typeof FIELD_APPLY_REQUEST_STATUSES)[number];

export type FieldApplyRequestUser = { id: string; fullName: string };

/** `null` = คำขอปกติ · มีค่า = ช่างขอแก้ค่าเฉพาะเครื่อง (Override) ในโหมด
 * central แล้วอนุมัติคำขอนี้ = อนุมัติ Override นั้นด้วย (docs/30 P1) */
export type FieldApplyRequestOverride = {
  id: string;
  reason: string;
  fieldNames: string[];
};

export type FieldApplyRequest = {
  id: string;
  taskId: string;
  deviceId: string;
  kind: "config" | "firmware";
  configId: string | null;
  firmwareId: string | null;
  overrideId: string | null;
  /** เวอร์ชัน Firmware ที่กล่องรายงานตอนขอ — null เมื่อ kind=config หรือไม่มี Server กลาง */
  fromFirmwareVersion: string | null;
  isDowngrade: boolean;
  /** ผู้ผูก Config เข้างาน (snapshot) — มีค่า = อนุมัติคำขอนี้ไม่ได้ (SoD) */
  configAssignedBy: string | null;
  requestedBy: string;
  requestedAt: string;
  expiresAt: string;
  note: string | null;
  status: FieldApplyRequestStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  rejectReason: string | null;
  task: { id: string; title: string };
  config: {
    id: string;
    name: string;
    deviceModel: string;
    protocol: string;
  } | null;
  firmware: { id: string; version: string } | null;
  requester: FieldApplyRequestUser;
  configAssigner: FieldApplyRequestUser | null;
  decider: FieldApplyRequestUser | null;
  /** ชื่อ field ที่จะส่ง (รวม Device Config Override ที่ approved) — ไม่มีค่าจริง · ว่างเมื่อ kind=firmware */
  fieldNames: string[];
  override: FieldApplyRequestOverride | null;
};

/** `GET /config-apply-requests` — คิวของ Operation เรียงใหม่สุดก่อน
 * `status` ไม่ระบุ = คืนทุกสถานะ */
export function listFieldApplyRequests(
  token: string,
  params?: { status?: FieldApplyRequestStatus },
): Promise<FieldApplyRequest[]> {
  const query = params?.status
    ? `?status=${encodeURIComponent(params.status)}`
    : "";
  return apiJson<FieldApplyRequest[]>(`/config-apply-requests${query}`, {
    token,
  });
}

/** `POST /config-apply-requests/{id}/approve` — เปลี่ยนเป็น `approved` เท่านั้น
 * ยังไม่ส่งเข้ากล่อง (รอช่างที่ถือ Task กดส่ง) · ถ้าผูก Override ไว้ อนุมัติ
 * Override นั้นด้วยในทรานแซกชันเดียวกัน (docs/30 P1) */
export function approveFieldApplyRequest(
  token: string,
  id: string,
): Promise<FieldApplyRequest> {
  return apiJson<FieldApplyRequest>(`/config-apply-requests/${id}/approve`, {
    method: "POST",
    token,
  });
}

/** `POST /config-apply-requests/{id}/reject` — `rejectReason` บังคับ (ต่างจาก
 * Device Config/Firmware Override ที่ไม่บังคับ) */
export function rejectFieldApplyRequest(
  token: string,
  id: string,
  body: { rejectReason: string },
): Promise<FieldApplyRequest> {
  return apiJson<FieldApplyRequest>(`/config-apply-requests/${id}/reject`, {
    method: "POST",
    token,
    body: JSON.stringify(body),
  });
}
