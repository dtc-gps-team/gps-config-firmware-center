import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboardIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  LibraryIcon,
  CircleCheckIcon,
  CpuIcon,
  RocketIcon,
  TriangleAlertIcon,
  ScrollTextIcon,
  UsersIcon,
} from "lucide-react";

import type { Role } from "@/lib/permissions";

export interface NavItem {
  label: string;
  href: string;
  /**
   * อ้างอิงชื่อหน้าจอใน docs/architecture/RBAC_Matrix.md Section 2
   */
  screenName: string;
  /** ไอคอนหน้าเมนู (mockup UX/UI Design ต้นฉบับมีไอคอนทุกเมนู — sidebar
   *  ของจริงยังไม่มีมาก่อน เพิ่มให้ตรงกันเพื่อลดความรู้สึก "แข็งทื่อ") */
  icon: LucideIcon;
  /**
   * จำกัด Role ที่เห็นเมนูนี้ — ใส่เฉพาะหน้าที่ RBAC_Matrix.md ระบุว่าบาง Role
   * เป็น "-" (ไม่มีสิทธิ์เข้าถึงจอนี้เลย) เช่น Audit Log (ยกเว้น
   * ConfigEngineer/FirmwareEngineer/QAEngineer) และ
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
  {
    label: "Dashboard",
    href: "/",
    screenName: "Dashboard / Main",
    icon: LayoutDashboardIcon,
  },
  {
    label: "Device Search",
    href: "/devices",
    screenName: "Device Search / Device Detail",
    icon: SearchIcon,
  },
  {
    label: "Config Editor",
    href: "/config",
    screenName: "Config Editor",
    icon: SlidersHorizontalIcon,
  },
  // "Config Import จากไฟล์ (JSON)" (RBAC_Matrix.md Section 2) ไม่มี entry ใน
  // sidebar โดยตั้งใจ — Build Reference §3.1 ระบุว่าเป็น "ปุ่มในหน้า Config
  // Editor ไม่ใช่หน้าจอแยก" · เข้าผ่านปุ่ม "Import จากไฟล์" ในหน้า /config
  // (ConfigEngineer เท่านั้น — import-config-button.tsx) ที่พาไป route
  // /config/import
  {
    label: "Parameter Library",
    href: "/parameters",
    screenName: "Config Definition Lookup (คลัง Parameter)",
    icon: LibraryIcon,
    // ตาราง 4.1: ConfigEngineer, Operation, ST, OT เท่านั้น (เดิม SW ก่อนแยก
    // role — docs/13 §3.1) — Auditor/Admin ยังไม่ให้เพราะยังไม่มี use case
    allowedRoles: ["ConfigEngineer", "Operation", "ST", "OT"],
  },
  {
    label: "Approval Center",
    href: "/approvals",
    screenName: "Approval Center",
    icon: CircleCheckIcon,
  },
  {
    label: "Firmware Repository",
    href: "/firmware",
    screenName: "Firmware Repository",
    icon: CpuIcon,
  },
  {
    label: "Campaign",
    href: "/campaigns",
    screenName: "Campaign Wizard / Campaign Monitor",
    icon: RocketIcon,
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
    icon: TriangleAlertIcon,
  },
  {
    label: "Audit Log",
    href: "/audit-log",
    screenName: "Audit Log",
    icon: ScrollTextIcon,
    // Section 2: ทุก Role มี R ยกเว้น ConfigEngineer/FirmwareEngineer/
    // QAEngineer ที่เป็น "-" (เดิม SW ตัวเดียวก่อนแยก role — docs/13 §3.1)
    allowedRoles: ["Operation", "ST", "OT", "Auditor", "Admin", "SuperAdmin"],
  },
  {
    label: "User Management",
    href: "/users",
    screenName: "User / Role Management",
    icon: UsersIcon,
    // Section 2: Admin + SuperAdmin (SuperAdmin ทำได้ทุกอย่างที่ Admin ทำได้ +
    // จัดการบัญชี Admin/SuperAdmin) — Role อื่นเป็น "-" หมด
    allowedRoles: ["Admin", "SuperAdmin"],
  },
];
