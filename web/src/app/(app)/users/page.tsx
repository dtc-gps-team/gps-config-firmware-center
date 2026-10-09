import { UserManagementView } from "./user-management-view";

export const metadata = {
  title: "User Management | GPS Config Center",
};

/**
 * User / Role Management (`GET /users/managed`, `POST /users`,
 * `PATCH /users/{id}`) — Admin เท่านั้น จัดการได้แค่บัญชีทั่วไป ไม่รวม
 * Admin/SuperAdmin (RBAC_Matrix.md §2 — แก้ครั้งที่ 38) gate ทั้งหน้าผ่าน
 * UserManagementView (ดูไฟล์นั้น) — "เพิ่มผู้ใช้" เป็น Dialog ในตัวแล้ว
 * (แก้ครั้งที่ 71) ไม่มี route `/users/new` แยกอีกต่อไป
 */
export default function UsersPage() {
  return <UserManagementView />;
}
