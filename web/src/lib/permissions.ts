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

export type Role =
  | "ConfigEngineer"
  | "FirmwareEngineer"
  | "QAEngineer"
  | "Operation"
  | "ST"
  | "OT"
  | "Auditor"
  | "Admin"
  | "SuperAdmin";

/**
 * ปุ่ม "สร้าง Config ใหม่" / "Import Config" — Section 2 แถว Config Editor,
 * Config Import: มีแค่ ConfigEngineer ที่มีสิทธิ์ Create (เดิม SW ก่อนแยก role
 * — docs/13_Role_Redesign_Proposal.md §3.1)
 */
export function canCreateConfig(role: string | null | undefined): boolean {
  return role === "ConfigEngineer";
}

/**
 * ปุ่ม "แก้ไข Config" (สถานะ draft) — Section 2 footnote ²: ConfigEngineer
 * ทุกคนแก้ไข draft ร่วมกันได้ ไม่ scope ตาม creator (ไม่ต้องเทียบ user id
 * เจ้าของ)
 */
export function canUpdateConfig(role: string | null | undefined): boolean {
  return role === "ConfigEngineer";
}

/**
 * ปุ่ม "Approve" / "Reject" ใน Approval Center — Section 2 + Section 5 ข้อ 1
 * (Separation of Duty): Operation เท่านั้น — ConfigEngineer ห้ามอนุมัติ
 * Config ของตัวเอง
 */
export function canDecideConfigApproval(
  role: string | null | undefined,
): boolean {
  return role === "Operation";
}

/**
 * ปุ่ม "Upload Firmware ใหม่" — Section 2 แถว Firmware Repository: มีแค่
 * FirmwareEngineer ที่มีสิทธิ์ Create (เดิม SW ก่อนแยก role — docs/13 §3.1)
 */
export function canUploadFirmware(role: string | null | undefined): boolean {
  return role === "FirmwareEngineer";
}

/**
 * ฟอร์มแก้ Compatibility Tag ของ Firmware — RBAC_Matrix.md ตาราง 4.1
 * `PATCH /firmware/{firmwareId}`: FirmwareEngineer เท่านั้น (resource
 * `firmware` action `Update`) แยกฟังก์ชันจาก `canUploadFirmware` แม้ role set
 * จะเหมือนกันตอนนี้ เพราะ backend เองก็แยก action Create/Update ไว้คนละสิทธิ์
 */
export function canUpdateFirmwareCompatibility(
  role: string | null | undefined,
): boolean {
  return role === "FirmwareEngineer";
}

/**
 * ปุ่ม "ทดสอบ Firmware" — RBAC_Matrix.md ตาราง 4.1 `POST /firmware/{firmwareId}/simulate`:
 * resource แยก `firmware-simulation` (ไม่ใช่ `firmware` เฉยๆ) —
 * FirmwareEngineer/QAEngineer/Operation/ST/OT เท่านั้น กัน Auditor/Admin ที่มี
 * แค่ `firmware.Read` เห็นปุ่มนี้โดยไม่ตั้งใจ (mirror `config`/`config-simulation`)
 * — QAEngineer เพิ่มเข้ามาใหม่ (docs/13 §3.1): ต้องดูผล simulation ก่อนตัดสินใจ
 * อนุมัติคุณภาพ
 */
export function canSimulateFirmware(role: string | null | undefined): boolean {
  return (
    role === "FirmwareEngineer" ||
    role === "QAEngineer" ||
    role === "Operation" ||
    role === "ST" ||
    role === "OT"
  );
}

/**
 * ปุ่ม "อนุมัติ" / "ปฏิเสธ" คุณภาพ Firmware — RBAC_Matrix.md ตาราง 4.1
 * `POST /firmware/{firmwareId}/approve` / `.../reject`: resource แยก
 * `firmware-decision` (mirror `config-decision`) — QAEngineer เท่านั้น
 * (docs/13_Role_Redesign_Proposal.md §3.2 — Firmware Approval Lifecycle)
 */
export function canDecideFirmwareApproval(
  role: string | null | undefined,
): boolean {
  return role === "QAEngineer";
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
 * หน้า Audit Log — Section 2 แถว Audit Log: ทุก Role มี R ยกเว้น
 * **ConfigEngineer/FirmwareEngineer/QAEngineer** (เดิม SW ตัวเดียวก่อนแยก role
 * — docs/13 §3.1) ที่เป็น "-" (ไม่มีสิทธิ์เข้าถึงจอนี้เลย ทั้ง 3 role ที่แยก
 * ออกมาสืบทอดข้อจำกัดนี้เหมือนกันหมด) ต่างจาก 4 หน้าด้านบนที่ทุก Role read
 * ได้หมด จุดนี้ต้อง gate ทั้งหน้า ไม่ใช่แค่ปุ่ม — ใช้คู่กับ RoleGuard
 */
export function canAccessAuditLog(role: string | null | undefined): boolean {
  return (
    role !== "ConfigEngineer" &&
    role !== "FirmwareEngineer" &&
    role !== "QAEngineer"
  );
}

/**
 * หน้า User / Role Management — Section 2 แถว User / Role Management:
 * Admin เท่านั้นที่มีสิทธิ์ (C, R, U) ทุก Role อื่นเป็น "-" หมด ต้อง gate
 * ทั้งหน้า — ใช้คู่กับ RoleGuard
 *
 * SuperAdmin รวมด้วย: ขอบเขต SuperAdmin = "ทำได้ทุกอย่างที่ Admin ทำได้ +
 * จัดการบัญชี Admin/SuperAdmin" (CLAUDE.md · RBAC_Matrix.md Section 2 คอลัมน์
 * SuperAdmin) — endpoint จริงของสิทธิ์เพิ่มเติม (`admin-management`,
 * `role-management`) รอ Part B2 · seed สิทธิ์ SuperAdmin ทำแล้วใน PR #123
 */
export function canAccessUserManagement(
  role: string | null | undefined,
): boolean {
  return role === "Admin" || role === "SuperAdmin";
}

/** ปุ่ม "สร้างแคมเปญ" — Section 2 แถว Campaign Wizard: Operation เท่านั้นที่มี C */
export function canCreateCampaign(role: string | null | undefined): boolean {
  return role === "Operation";
}

/**
 * ปุ่ม "อนุมัติ" / "ปฏิเสธ" Campaign — Section 2 แถว Campaign Wizard (Campaign
 * Approval, แก้ครั้งที่ 39): Operation เท่านั้น (resource `campaign` action
 * `Approve`) — role check นี้ไม่พอ: Separation of Duty (ผู้สร้าง Campaign
 * อนุมัติของตัวเองไม่ได้) ต้องเทียบ user id เพิ่มที่หน้าเรียกใช้เอง (ดู
 * `campaign-approval-panel.tsx` — ใช้ `getTokenSubject` มิเรอร์
 * `approval-center-view.tsx`) เพราะ role ต้องแยกออกจาก "ใช่ผู้สร้างไหม"
 * คนละมิติกัน
 */
export function canDecideCampaignApproval(
  role: string | null | undefined,
): boolean {
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
 * `GET /config-definitions`: ConfigEngineer, Operation, ST, OT เท่านั้น (เดิม
 * SW ก่อนแยก role — docs/13 §3.1 · FirmwareEngineer/QAEngineer ไม่ได้ เพราะ
 * ไม่ทำงานกับ Config) — Auditor/Admin ยังไม่ให้เพราะยังไม่มี use case
 * (ต่างจากหน้าอื่นที่ทุก Role อ่านได้หมด) ต้อง gate ทั้งหน้า — ใช้คู่กับ
 * RoleGuard
 */
export function canAccessParameterLibrary(
  role: string | null | undefined,
): boolean {
  return (
    role === "ConfigEngineer" ||
    role === "Operation" ||
    role === "ST" ||
    role === "OT"
  );
}

/**
 * ปุ่ม/ฟอร์ม "สร้าง Parameter ใหม่" — RBAC_Matrix.md ตาราง 4.1
 * `POST /config-definitions`: ConfigEngineer เท่านั้น (self-service ไม่ต้อง
 * ผ่านอนุมัติ — ตัดสินใจร่วมกับ B และพี่เลี้ยง 2569-09 · เดิม SW ก่อนแยก role)
 */
export function canCreateFieldDefinition(
  role: string | null | undefined,
): boolean {
  return role === "ConfigEngineer";
}
