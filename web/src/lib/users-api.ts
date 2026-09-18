import { apiJson } from "@/lib/api";

/**
 * Users API client — `GET /users` (openapi `listUsers` · schema `UserSummary`)
 * ใช้ทำ dropdown "เจาะจงผู้อนุมัติ" ใน Approval Center + User / Role Management
 * (Admin เท่านั้น — `listManagedUsers`/`createUser`/`updateUser` ด้านล่าง)
 * จัดการได้แค่บัญชีทั่วไป ไม่รวม Admin/SuperAdmin (RBAC_Matrix.md §2 — แก้ครั้งที่ 38)
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

/** role ที่เลือกได้ในหน้า User / Role Management — ตรงกับ
 * `EXCLUDED_MANAGED_ROLE_CODES` ฝั่ง backend (`managed-user-roles.ts`) แค่กลับ
 * ด้าน (allow-list ฝั่ง UI ง่ายกว่า exclude-list ตอนทำ dropdown) — Admin/
 * SuperAdmin ไม่อยู่ในนี้โดยตั้งใจ (จัดการผ่าน `admin-management` ที่ยังไม่ทำ) */
export const MANAGEABLE_ROLE_CODES = [
  "ConfigEngineer",
  "FirmwareEngineer",
  "QAEngineer",
  "Operation",
  "ST",
  "OT",
  "Auditor",
] as const;

/** `ManagedUser` ใน openapi.yaml — เต็มกว่า `UserSummary` (มี username/isActive)
 * role เป็นไปได้แค่ role ที่ไม่ใช่ Admin/SuperAdmin เท่านั้น */
export type ManagedUser = {
  id: string;
  username: string;
  fullName: string;
  role: string;
  isActive: boolean;
};

/**
 * `GET /users/managed` — Admin เท่านั้น · คืนบัญชีทั่วไปทั้งหมด (รวม inactive)
 * ตัด Admin/SuperAdmin ออกเสมอ
 */
export function listManagedUsers(token: string): Promise<ManagedUser[]> {
  return apiJson<ManagedUser[]>("/users/managed", { token });
}

/** request body — `CreateUserInput` ใน openapi.yaml */
export type CreateUserInput = {
  username: string;
  fullName: string;
  password: string;
  role: string;
};

/**
 * `POST /users` — Admin เท่านั้น · สร้างบัญชีทั่วไปใหม่ (`role` ต้องไม่ใช่
 * Admin/SuperAdmin — 400 ถ้าเป็น) · Admin ตั้งรหัสผ่านเริ่มต้นเอง
 */
export function createUser(
  token: string,
  input: CreateUserInput,
): Promise<ManagedUser> {
  return apiJson<ManagedUser>("/users", {
    method: "POST",
    token,
    body: JSON.stringify(input),
  });
}

/** request body — `UpdateUserInput` ใน openapi.yaml (ทั้งคู่ optional) */
export type UpdateUserInput = {
  role?: string;
  isActive?: boolean;
};

/**
 * `PATCH /users/{id}` — Admin เท่านั้น · แก้ role และ/หรือ isActive · ไม่มี
 * hard delete (ปิดใช้งานผ่าน `isActive: false` แทน)
 */
export function updateUser(
  token: string,
  id: string,
  input: UpdateUserInput,
): Promise<ManagedUser> {
  return apiJson<ManagedUser>(`/users/${id}`, {
    method: "PATCH",
    token,
    body: JSON.stringify(input),
  });
}
