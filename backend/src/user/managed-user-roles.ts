/**
 * User / Role Management (RBAC_Matrix.md §2: "บัญชีทั่วไป — ไม่รวม
 * Admin/SuperAdmin") — จัดการได้แค่บัญชีที่ role ไม่ใช่ 2 ตัวนี้ การจัดการ
 * บัญชี Admin/SuperAdmin เองเป็นสิทธิ์ resource `admin-management` ที่ยังไม่
 * finalize (รอ docs/11 — CLAUDE.md §Role Enum) ตกลงกับ paveekornk (A) แล้วว่า
 * จะยังไม่ทำส่วนนั้นในรอบนี้ (2026-09-18)
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
