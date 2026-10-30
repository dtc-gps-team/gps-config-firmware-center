/**
 * User / Role Management (RBAC_Matrix.md §2: "บัญชีทั่วไป — ไม่รวม
 * Admin/SuperAdmin") — Admin ธรรมดาจัดการได้แค่บัญชีที่ role ไม่ใช่ 2 ตัวนี้
 * (list นี้ยังใช้กรอง Admin ธรรมดาเหมือนเดิมทุกประการ)
 *
 * SuperAdmin จัดการบัญชี Admin/SuperAdmin ได้แล้วผ่านหน้า User Management
 * เดิมนี้เอง (มติ 2026-10-30 — ไม่สร้าง resource/หน้าใหม่ `admin-management`
 * แยก) — ดู `user.service.ts` ที่ข้าม filter นี้เมื่อ `actor.role ===
 * 'SuperAdmin'`
 *
 * ใช้ exclude-list (ไม่ใช่ allow-list) โดยตั้งใจ — Role ใหม่ที่ Admin สร้างเพิ่ม
 * ทีหลังผ่านหน้านี้เอง (เช่นในอนาคตถ้ามี role-management จริง) จะจัดการผ่านหน้า
 * นี้ได้ทันทีโดยไม่ต้องแก้ list นี้ มีแค่ Admin/SuperAdmin เท่านั้นที่ต้องกันไว้
 * เป็นพิเศษเพราะผูกกับสิทธิ์ระดับสูงสุดของระบบ
 */
export const EXCLUDED_MANAGED_ROLE_CODES: readonly string[] = [
  'Admin',
  'SuperAdmin',
];
