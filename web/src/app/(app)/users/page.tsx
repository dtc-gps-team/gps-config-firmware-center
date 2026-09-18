import { UserManagementView } from "./user-management-view";

export const metadata = {
  title: "User Management | GPS Config Center",
};

/**
 * User / Role Management (`GET /users/managed`, `POST /users`,
 * `PATCH /users/{id}`) — Admin เท่านั้น จัดการได้แค่บัญชีทั่วไป ไม่รวม
 * Admin/SuperAdmin (RBAC_Matrix.md §2 — แก้ครั้งที่ 38) gate ทั้งหน้าผ่าน
 * UserManagementView (ดูไฟล์นั้น)
 */
export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string }>;
}) {
  const { created } = await searchParams;

  return <UserManagementView justCreatedId={created ?? null} />;
}
