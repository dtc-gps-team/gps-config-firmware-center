/**
 * Role-based permission helpers — ฝั่ง Web (UI-level gate เท่านั้น)
 *
 * อ้างอิงจาก docs/architecture/RBAC_Matrix.md Section 2 — หน้าส่วนใหญ่ทุก
 * Role มีสิทธิ์อย่างน้อย Read (R) (Dashboard, Device Search, Config Editor,
 * Config Import, Approval Center, Firmware Repository, Campaign, Task
 * Management, Incident & Rollback) ที่ต่างกันจริงคือ action ภายในหน้า (ปุ่ม
 * Create/Update/Approve ฯลฯ) — ใช้ function ด้านล่างคู่กับการซ่อน/ปิดปุ่ม
 * ตรงๆ ในหน้านั้น ส่วนหน้าที่บาง Role เป็น "-" หมดทั้งแถว (Audit Log,
 * User Management) ต้อง gate ทั้งหน้าแทน — ใช้คู่กับ
 * `web/src/components/auth/role-guard.tsx`
 *
 * สำคัญ: นี่คือ UX-level gate เท่านั้น (ซ่อน/ปิดปุ่มหรือหน้าที่กดไป/เข้าไปก็
 * จะโดน backend PermissionGuard ปฏิเสธอยู่ดี) การบังคับสิทธิ์จริงอยู่ที่
 * backend เสมอ — พลาดจุดไหนในไฟล์นี้ไม่กระทบความปลอดภัยของระบบ แค่ UX ไม่
 * สมบูรณ์
 */

export type Role = "SW" | "Operation" | "ST" | "OT" | "Auditor" | "Admin";

/**
 * ปุ่ม "สร้าง Config ใหม่" / "Import Config" — Section 2 แถว Config Editor,
 * Config Import: มีแค่ SW ที่มีสิทธิ์ Create
 */
export function canCreateConfig(role: string | null | undefined): boolean {
  return role === "SW";
}

/**
 * ปุ่ม "แก้ไข Config" (สถานะ draft) — Section 2 footnote ²: SW ทุกคนแก้ไข
 * draft ร่วมกันได้ ไม่ scope ตาม creator (ไม่ต้องเทียบ user id เจ้าของ)
 */
export function canUpdateConfig(role: string | null | undefined): boolean {
  return role === "SW";
}

/**
 * ปุ่ม "Approve" / "Reject" ใน Approval Center — Section 2 + Section 5 ข้อ 1
 * (Separation of Duty): Operation เท่านั้น — SW ห้ามอนุมัติ Config ของตัวเอง
 */
export function canDecideConfigApproval(
  role: string | null | undefined,
): boolean {
  return role === "Operation";
}

/**
 * ปุ่ม "Upload Firmware ใหม่" — Section 2 แถว Firmware Repository: มีแค่ SW
 * ที่มีสิทธิ์ Create
 */
export function canUploadFirmware(role: string | null | undefined): boolean {
  return role === "SW";
}

/**
 * Override Config/Firmware รายเครื่อง — Section 2: ST, OT เท่านั้น
 * (C, R, U, O) ยังไม่มีหน้านี้ scaffold ไว้ใน NAV_ITEMS ตอนนี้ — เตรียมไว้
 * ล่วงหน้าเผื่อเพิ่มหน้านี้ทีหลัง
 */
export function canOverrideDevice(role: string | null | undefined): boolean {
  return role === "ST" || role === "OT";
}

/**
 * หน้า Audit Log — Section 2 แถว Audit Log: ทุก Role มี R ยกเว้น **SW** ที่
 * เป็น "-" (ไม่มีสิทธิ์เข้าถึงจอนี้เลย) ต่างจาก 4 หน้าด้านบนที่ทุก Role read
 * ได้หมด จุดนี้ต้อง gate ทั้งหน้า ไม่ใช่แค่ปุ่ม — ใช้คู่กับ RoleGuard
 */
export function canAccessAuditLog(role: string | null | undefined): boolean {
  return role !== "SW";
}

/**
 * หน้า User / Role Management — Section 2 แถว User / Role Management:
 * Admin เท่านั้นที่มีสิทธิ์ (C, R, U) ทุก Role อื่นเป็น "-" หมด ต้อง gate
 * ทั้งหน้า — ใช้คู่กับ RoleGuard
 */
export function canAccessUserManagement(
  role: string | null | undefined,
): boolean {
  return role === "Admin";
}

/** ปุ่ม "สร้างแคมเปญ" — Section 2 แถว Campaign Wizard: Operation เท่านั้นที่มี C */
export function canCreateCampaign(role: string | null | undefined): boolean {
  return role === "Operation";
}

/**
 * ปุ่ม "สร้าง/มอบหมาย Task" — Section 4.3 (ปิด open question: Task creator
 * = Operation): Operation เท่านั้น ST/OT ห้ามสร้าง Task เอง (ป้องกันมอบหมาย
 * งานให้ตัวเอง) — แก้ status งานตัวเอง (รับ/ปิดงาน) ทำผ่าน Mobile เท่านั้น
 */
export function canManageTask(role: string | null | undefined): boolean {
  return role === "Operation";
}

/**
 * ปุ่ม "สั่ง Rollback" ใน Incident & Rollback — Section 2 แถว Incident &
 * Rollback: Operation เท่านั้นที่มี U (สั่ง Rollback)
 */
export function canDecideIncidentRollback(
  role: string | null | undefined,
): boolean {
  return role === "Operation";
}

/**
 * ปุ่ม "แก้ไขเชิงเทคนิค" ใน Incident & Rollback — Section 2 แถว Incident &
 * Rollback: ST เท่านั้นที่มี R, U (แก้ไขเชิงเทคนิค) — OT มีแค่ R
 */
export function canEditIncidentTechnical(
  role: string | null | undefined,
): boolean {
  return role === "ST";
}

/**
 * หน้าคลัง Parameter (Config Definition Lookup) — RBAC_Matrix.md ตาราง 4.1
 * `GET /config-definitions`: SW, Operation, ST, OT เท่านั้น — Auditor/Admin
 * ยังไม่ให้เพราะยังไม่มี use case (ต่างจากหน้าอื่นที่ทุก Role อ่านได้หมด)
 * ต้อง gate ทั้งหน้า — ใช้คู่กับ RoleGuard
 */
export function canAccessParameterLibrary(
  role: string | null | undefined,
): boolean {
  return (
    role === "SW" ||
    role === "Operation" ||
    role === "ST" ||
    role === "OT"
  );
}

/**
 * ปุ่ม/ฟอร์ม "สร้าง Parameter ใหม่" — RBAC_Matrix.md ตาราง 4.1
 * `POST /config-definitions`: SW เท่านั้น (self-service ไม่ต้องผ่านอนุมัติ —
 * ตัดสินใจร่วมกับ B และพี่เลี้ยง 2569-09)
 */
export function canCreateFieldDefinition(
  role: string | null | undefined,
): boolean {
  return role === "SW";
}
