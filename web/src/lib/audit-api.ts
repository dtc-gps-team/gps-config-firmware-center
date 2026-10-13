import { apiJson } from "@/lib/api";

/**
 * Audit API client — `GET /audit-logs` (openapi `listAuditLogs`, tag `audit`,
 * schema `AuditLogEntry`) · read-only, mutation-only log (Sprint 3 #27)
 */

/** `AuditLogEntry` ใน openapi.yaml — ไม่มีชื่อผู้ทำรายการมาให้ตรงๆ (แค่
 * `userId`) — ยังไม่มี endpoint list user แบบย่อในสาขานี้ให้ resolve ชื่อ
 * (ดู Approval Center #19 — `GET /users`) หน้า Audit Log เลยแสดง userId ดิบ
 * ไปก่อน (ดู use-audit-logs.ts) */
export type AuditLogEntry = {
  id: string;
  userId: string;
  auditModule: string;
  action: string;
  ipAddress: string | null;
  /** รายละเอียดเชิงโครงสร้างเพิ่มเติม (issue #205) — มีเฉพาะบาง action ที่
   * ถือว่าสำคัญ/จำเป็นต่อการตรวจสอบ (ตอนนี้มีแค่ `apply-config`) แถวเก่าเป็น
   * `null` — ยังไม่มี UI แสดงผลค่านี้ในหน้า Audit Log */
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

/** `AuditLogPage` ใน openapi.yaml (v3.49) — `total` นับทุกแถวที่ตรง filter
 * ไม่ใช่แค่ในหน้านี้ */
export type AuditLogPage = {
  items: AuditLogEntry[];
  total: number;
  page: number;
  pageSize: number;
};

/** filter ทุกตัว optional — ไม่ส่ง = ทุกรายการ เรียงตาม createdAt desc ·
 * ไม่ส่ง page/pageSize = backend ใช้ default (หน้า 1, 20 แถว) */
export function listAuditLogs(
  token: string,
  params?: {
    userId?: string;
    auditModule?: string;
    action?: string;
    page?: number;
    pageSize?: number;
  },
): Promise<AuditLogPage> {
  const query = new URLSearchParams();
  if (params?.userId) query.set("userId", params.userId);
  if (params?.auditModule) query.set("auditModule", params.auditModule);
  if (params?.action) query.set("action", params.action);
  if (params?.page) query.set("page", String(params.page));
  if (params?.pageSize) query.set("pageSize", String(params.pageSize));
  const qs = query.toString();
  return apiJson<AuditLogPage>(`/audit-logs${qs ? `?${qs}` : ""}`, {
    token,
  });
}
