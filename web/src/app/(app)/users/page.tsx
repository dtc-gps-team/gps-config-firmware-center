import { UserManagementView } from "./user-management-view";

export const metadata = {
  title: "User Management | GPS Config Center",
};

/**
 * Scaffold — รอต่อโมดูล `users` (ยังไม่มี endpoint ใน spec — ดู
 * RBAC_Matrix.md ตาราง 4.2) มีแค่ Admin ที่มีสิทธิ์ทั้งแถว — gate ทั้งหน้า
 * ผ่าน UserManagementView (ดูไฟล์นั้น)
 */
export default function UsersPage() {
  return <UserManagementView />;
}
