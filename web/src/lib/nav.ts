import type { Role } from "@/lib/permissions";

export interface NavItem {
  label: string;
  href: string;
  /**
   * อ้างอิงชื่อหน้าจอใน docs/architecture/RBAC_Matrix.md Section 2
   */
  screenName: string;
  /**
   * จำกัด Role ที่เห็นเมนูนี้ — ใส่เฉพาะหน้าที่ RBAC_Matrix.md ระบุว่าบาง Role
   * เป็น "-" (ไม่มีสิทธิ์เข้าถึงจอนี้เลย) เช่น Audit Log (ยกเว้น SW) และ
   * User Management (Admin เท่านั้น) ปล่อยว่างไว้ = ทุก Role เห็นเมนูนี้ เพราะ
   * ส่วนใหญ่ทุก Role มีอย่างน้อย R (ความต่างจริงอยู่ที่ปุ่ม/action ในหน้า ไป
   * gate ที่ web/src/lib/permissions.ts แทน)
   */
  allowedRoles?: Role[];
}

/**
 * รายการหน้าจอที่ scaffold แล้ว (ดู RBAC_Matrix.md Section 2 สำหรับหน้าจอ
 * ทั้งหมด ~19 หน้า) — ที่เหลือ (Change Request Inbox, Decommission Device,
 * Notification Center) ยังไม่มี backend module รองรับ ยังไม่ scaffold route
 * ให้
 *
 * กรองเมนูตาม role ผู้ใช้แล้ว (ผ่าน `allowedRoles` — ดู nav-links.tsx) สำหรับ
 * หน้าที่ RBAC_Matrix.md ระบุว่าบาง Role เป็น "-" หมดทั้งแถว
 */
export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/", screenName: "Dashboard / Main" },
  {
    label: "Device Search",
    href: "/devices",
    screenName: "Device Search / Device Detail",
  },
  { label: "Config Editor", href: "/config", screenName: "Config Editor" },
  // "Config Import จากไฟล์ (JSON)" (RBAC_Matrix.md Section 2) ไม่มี entry ใน
  // sidebar โดยตั้งใจ — Build Reference §3.1 ระบุว่าเป็น "ปุ่มในหน้า Config
  // Editor ไม่ใช่หน้าจอแยก" · เข้าผ่านปุ่ม "Import จากไฟล์" ในหน้า /config
  // (SW เท่านั้น — import-config-button.tsx) ที่พาไป route /config/import
  {
    label: "Parameter Library",
    href: "/parameters",
    screenName: "Config Definition Lookup (คลัง Parameter)",
    // ตาราง 4.1: SW, Operation, ST, OT เท่านั้น — Auditor/Admin ยังไม่ให้
    // เพราะยังไม่มี use case
    allowedRoles: ["SW", "Operation", "ST", "OT"],
  },
  {
    label: "Approval Center",
    href: "/approvals",
    screenName: "Approval Center",
  },
  {
    label: "Firmware Repository",
    href: "/firmware",
    screenName: "Firmware Repository",
  },
  {
    label: "Campaign",
    href: "/campaigns",
    screenName: "Campaign Wizard / Campaign Monitor",
  },
  // "Task Management" ยกเลิกถาวร ไม่มีวันกลับมา (มติพี่เลี้ยงล่าสุด — สืบเนื่อง
  // จาก PR #144 review, ดู RBAC_Matrix.md Section 6 แก้ครั้งที่ 25) เดิมพักไว้
  // ตามมติ Sprint 1 review ข้อ 1 (docs/09 §2) ว่าจะ redesign เป็น list +
  // ฟอร์มมอบหมายพื้นฐาน — ตอนนี้ปิดขาดแล้ว: การมอบหมายงานย้ายไปอยู่ในขั้นตอน
  // "มอบหมายผู้รับผิดชอบหน้างาน" ตอนสร้าง Campaign แทน (Sprint 3 #21) · scaffold
  // เดิม (`_tasks/`) ถูกลบทิ้งแล้ว ไม่ใช่แค่ซ่อน
  {
    label: "Incident & Rollback",
    href: "/incidents",
    screenName: "Incident & Rollback",
  },
  {
    label: "Audit Log",
    href: "/audit-log",
    screenName: "Audit Log",
    // Section 2: ทุก Role มี R ยกเว้น SW ที่เป็น "-"
    allowedRoles: ["Operation", "ST", "OT", "Auditor", "Admin", "SuperAdmin"],
  },
  {
    label: "User Management",
    href: "/users",
    screenName: "User / Role Management",
    // Section 2: Admin + SuperAdmin (SuperAdmin ทำได้ทุกอย่างที่ Admin ทำได้ +
    // จัดการบัญชี Admin/SuperAdmin) — Role อื่นเป็น "-" หมด
    allowedRoles: ["Admin", "SuperAdmin"],
  },
];
