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
  createdAt: string;
};

/** filter ทุกตัว optional — ไม่ส่ง = ทุกรายการ เรียงตาม createdAt desc */
export function listAuditLogs(
  token: string,
  params?: { userId?: string; auditModule?: string; action?: string },
): Promise<AuditLogEntry[]> {
  const query = new URLSearchParams();
  if (params?.userId) query.set("userId", params.userId);
  if (params?.auditModule) query.set("auditModule", params.auditModule);
  if (params?.action) query.set("action", params.action);
  const qs = query.toString();
  return apiJson<AuditLogEntry[]>(`/audit-logs${qs ? `?${qs}` : ""}`, {
    token,
  });
}
