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
  LayersIcon,
} from "lucide-react";

import type { Role } from "@/lib/permissions";

/**
 * กลุ่มเมนูใน sidebar (UI ปรับใหม่ 2026-10) — เดิม 11 เมนูเรียงยาวต่อกัน
 * ไม่มีหัวข้อ หาเมนูยาก จัดกลุ่มตามงานที่ทำ ลำดับใน array = ลำดับที่แสดง
 * ชื่อเมนูยังเป็นภาษาอังกฤษตามเดิม (ตรงกับเอกสาร/คู่มือทดสอบ) ส่วนหัวกลุ่ม
 * เป็นภาษาไทย
 */
export const NAV_GROUPS = [
  { id: "overview", label: "ภาพรวม" },
  { id: "config", label: "Config และ Firmware" },
  { id: "deploy", label: "อุปกรณ์และการ Deploy" },
  { id: "system", label: "ระบบ" },
] as const;

export type NavGroupId = (typeof NAV_GROUPS)[number]["id"];

export interface NavItem {
  /** กลุ่มที่เมนูนี้อยู่ใน sidebar — ดู `NAV_GROUPS` */
  group: NavGroupId;
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
    group: "overview",
    screenName: "Dashboard / Main",
    icon: LayoutDashboardIcon,
  },
  {
    label: "Device Search",
    href: "/devices",
    group: "deploy",
    screenName: "Device Search / Device Detail",
    icon: SearchIcon,
  },
  {
    label: "Config Editor",
    href: "/config",
    group: "config",
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
    group: "config",
    screenName: "Config Definition Lookup (คลัง Parameter)",
    icon: LibraryIcon,
    // ตาราง 4.1: ConfigEngineer, Operation, ST, OT เท่านั้น (เดิม SW ก่อนแยก
    // role — docs/13 §3.1) — Auditor/Admin ยังไม่ให้เพราะยังไม่มี use case
    allowedRoles: ["ConfigEngineer", "Operation", "ST", "OT"],
  },
  {
    label: "Approval Center",
    href: "/approvals",
    group: "overview",
    screenName: "Approval Center",
    icon: CircleCheckIcon,
  },
  {
    label: "Firmware Repository",
    href: "/firmware",
    group: "config",
    screenName: "Firmware Repository",
    icon: CpuIcon,
    // Section 2: ConfigEngineer เป็น "-" (ไม่มีสิทธิ์อ่าน Firmware เลย) role อื่นมี R ขึ้นไป
    allowedRoles: [
      "FirmwareEngineer",
      "QAEngineer",
      "Operation",
      "ST",
      "OT",
      "Auditor",
      "Admin",
      "SuperAdmin",
    ],
  },
  {
    label: "Campaign",
    href: "/campaigns",
    group: "deploy",
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
    group: "deploy",
    screenName: "Incident & Rollback",
    icon: TriangleAlertIcon,
  },
  {
    label: "Audit Log",
    href: "/audit-log",
    group: "system",
    screenName: "Audit Log",
    icon: ScrollTextIcon,
    // Section 2: ทุก Role มี R ยกเว้น ConfigEngineer/FirmwareEngineer/
    // QAEngineer ที่เป็น "-" (เดิม SW ตัวเดียวก่อนแยก role — docs/13 §3.1)
    allowedRoles: ["Operation", "ST", "OT", "Auditor", "Admin", "SuperAdmin"],
  },
  {
    label: "User Management",
    href: "/users",
    group: "system",
    screenName: "User / Role Management",
    icon: UsersIcon,
    // Section 2: Admin + SuperAdmin (SuperAdmin ทำได้ทุกอย่างที่ Admin ทำได้ +
    // จัดการบัญชี Admin/SuperAdmin) — Role อื่นเป็น "-" หมด
    allowedRoles: ["Admin", "SuperAdmin"],
  },
  {
    label: "Device Model",
    href: "/device-models",
    group: "system",
    screenName: "DeviceModel Management (ไม่มีชื่อจอทางการใน RBAC_Matrix.md —"
      + " เพิ่งเพิ่มหน้านี้ 2026-10-07 ปิด gap ที่เดิมมีแค่ backend"
      + " (issue #209) ไม่มี Web UI ให้ Admin ใช้เลย)",
    icon: LayersIcon,
    // ตาราง 4.1 createDeviceModel/updateDeviceModel: Admin เท่านั้น
    // (SuperAdmin ได้อัตโนมัติจาก seed.ts) — Role อื่นอ่านได้ผ่าน dropdown
    // ตอนสร้าง Config/Parameter อยู่แล้ว ไม่ต้องมีเมนูเข้าหน้านี้ตรงๆ
    allowedRoles: ["Admin", "SuperAdmin"],
  },
];

/** เมนูที่ Role นี้เห็น — ไม่ใส่ `allowedRoles` = ทุก Role เห็น */
export function visibleNavItems(role: string | null | undefined): NavItem[] {
  return NAV_ITEMS.filter(
    (item) =>
      !item.allowedRoles || item.allowedRoles.some((r) => r === role),
  );
}

/**
 * เมนูที่ "ครอบ" หน้าปัจจุบัน — match ที่ขอบ segment (ไม่ใช่ prefix เปล่าๆ)
 * แล้วเลือกอันที่เจาะจงที่สุด (href ยาวสุด) เพื่อให้ /devices/:id ยัง
 * highlight "Device Search" อยู่ · หน้าย่อยที่ไม่มี nav item ของตัวเอง
 * (/config/new, /config/import, /config/:id) จะได้ "Config Editor"
 *
 * ใช้ทั้ง sidebar (highlight) และ breadcrumb บนแถบบน ให้สองที่ตรงกันเสมอ
 */
export function findActiveNavItem(
  items: NavItem[],
  pathname: string,
): NavItem | null {
  return items
    .filter((item) =>
      item.href === "/"
        ? pathname === "/"
        : pathname === item.href || pathname.startsWith(`${item.href}/`),
    )
    .reduce<NavItem | null>(
      (best, item) =>
        best === null || item.href.length > best.href.length ? item : best,
      null,
    );
}
