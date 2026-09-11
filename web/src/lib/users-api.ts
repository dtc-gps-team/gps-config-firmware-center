import { apiJson } from "@/lib/api";

/**
 * Users API client — `GET /users` (openapi `listUsers` · schema `UserSummary`)
 *
 * รอบนี้มีแค่ list ย่อสำหรับ dropdown "เจาะจงผู้อนุมัติ" ใน Approval Center ·
 * **ไม่ใช่** จอ User / Role Management (Admin เท่านั้น — ยังไม่มีใน spec)
 */

/** `UserSummary` ใน openapi.yaml — id + ชื่อ + role code เท่านั้น */
export type UserSummary = {
  id: string;
  fullName: string;
  role: string;
};

/** รายชื่อ user (เฉพาะ active · เรียงตามชื่อ) · `role` = filter ตาม role code */
export function listUsers(
  token: string,
  params?: { role?: string },
): Promise<UserSummary[]> {
  const query = params?.role
    ? `?role=${encodeURIComponent(params.role)}`
    : "";
  return apiJson<UserSummary[]>(`/users${query}`, { token });
}
