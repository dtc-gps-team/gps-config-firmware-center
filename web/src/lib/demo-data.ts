/**
 * DEMO DATA — ข้อมูลตัวอย่างสำหรับ demo (ยังไม่ต่อ API จริง)
 * ============================================================
 * ทุกหน้าใน (app) ตอนนี้เป็น scaffold ที่ตั้งใจยังไม่ต่อ backend (Sprint 1
 * นับหน้าเว็บเป็นแค่โครง — ดู docs/planning/02_GPS_Development_Plan.md) ไฟล์นี้ให้ข้อมูล
 * นิ่งๆ ไว้ render ในตารางแทนแถว "ยังไม่มีข้อมูล" เพื่อให้ demo เห็นภาพ
 *
 * แพทเทิร์นเดียวกับ `_mockTasks` ที่ mobile เคย hardcode ใน `home_page.dart`
 * ก่อนต่อ `GET /tasks` จริง (PR #72)
 *
 * **เมื่อถึง Sprint ที่ต้องต่อหน้าจริง:** ลบ import ของไฟล์นี้ในแต่ละหน้า
 * แล้วต่อ API ตาม operationId ที่ระบุใน comment ของแต่ละ export — RBAC gate
 * (ปุ่ม/RoleGuard) ในหน้าเหล่านั้นไม่ต้องแตะ ยังใช้ได้เหมือนเดิม
 */

/* ---------------------------------------------------------------- */
/*  status pill — ย้ายไป `@/lib/status-pill` แล้ว (ไม่ใช่ demo data —    */
/*  หน้าจริงที่ต่อ API ก็ใช้) re-export ต่อให้หน้า scaffold เดิมไม่ต้องแก้ import */
/* ---------------------------------------------------------------- */

import {
  CheckCircle2Icon,
  CpuIcon,
  GitCompareIcon,
  HistoryIcon,
  RotateCcwIcon,
  TriangleAlertIcon,
  Undo2Icon,
  WifiIcon,
  WifiOffIcon,
  XCircleIcon,
  type LucideIcon,
} from "lucide-react";

import { TASK_STATUS_TONE, type PillTone } from "@/lib/status-pill";

export {
  pillClass,
  CONFIG_STATUS_TONE,
  TASK_STATUS_TONE,
  DEVICE_STATUS_TONE,
} from "@/lib/status-pill";

/* ---------------------------------------------------------------- */
/*  Dashboard — จัดตาม docs/planning §12.1 (Device Overview /          */
/*  Deployment Overview / Risk Dashboard) · Customer Priority ไม่เคย    */
/*  ออกแบบไว้ในระบบนี้เลย + Capacity เป็น infra metric ที่ตัดออกจาก scope  */
/*  แล้ว (production integration ของ config-sync-writer ไม่ใช่งาน A) —   */
/*  เลยไม่มีในแดชบอร์ด · ที่เหลือ metric ไหนมี endpoint จริงแล้วต่อจริงที่    */
/*  dashboard-summary.tsx (`GET /devices`, `/config`, `/campaigns`) —    */
/*  metric ที่ยังไม่มี endpoint (ต้องรอ device-sync module ที่กำลังเสนอ    */
/*  อยู่ตอนนี้ หรือ Campaign Monitor #22) ใส่เป็นตัวอย่างไว้ก่อนที่นี่      */
/* ---------------------------------------------------------------- */

type DashboardMetric = {
  label: string;
  value: string;
  icon: LucideIcon;
  tone: PillTone;
};

/** Device Overview — Total/รุ่นอุปกรณ์ ต่อ `GET /devices` จริงแล้ว (ดู
 * dashboard-summary.tsx) ที่เหลือรอ device-sync module (docs/14 proposal —
 * ยังไม่ตัดสินใจ ไม่ใช่ตัดออกจาก scope) */
export const DEMO_DEVICE_OVERVIEW: DashboardMetric[] = [
  { label: "Online", value: "142", icon: WifiIcon, tone: "success" },
  { label: "Offline", value: "8", icon: WifiOffIcon, tone: "danger" },
  { label: "Firmware ไม่ตรงเวอร์ชันล่าสุด", value: "12", icon: CpuIcon, tone: "progress" },
  { label: "Config ไม่ตรงเวอร์ชันล่าสุด", value: "5", icon: HistoryIcon, tone: "progress" },
  { label: "Config/Firmware Drift", value: "3", icon: GitCompareIcon, tone: "danger" },
];

/** Deployment Overview — Campaign กำลังทำงาน/รออนุมัติ + Config รออนุมัติ
 * ต่อ API จริงแล้ว (ดู dashboard-summary.tsx) ที่เหลือรอ Campaign Monitor
 * (#22 — วางคิวไว้แล้ว ไม่ใช่ตัดออกจาก scope) */
export const DEMO_DEPLOYMENT_OVERVIEW: DashboardMetric[] = [
  { label: "สำเร็จ", value: "128", icon: CheckCircle2Icon, tone: "success" },
  { label: "ล้มเหลว", value: "4", icon: XCircleIcon, tone: "danger" },
  { label: "Rollback", value: "1", icon: Undo2Icon, tone: "danger" },
];

/** Risk Dashboard — ทั้งหมดรอ device-sync module (docs/14 proposal) ยังไม่มี
 * metric ไหนต่อจริงได้เลยตอนนี้ */
export const DEMO_RISK_DASHBOARD: DashboardMetric[] = [
  { label: "Failure สูง", value: "6", icon: TriangleAlertIcon, tone: "danger" },
  { label: "Firmware Suspended", value: "2", icon: CpuIcon, tone: "danger" },
  { label: "Reboot Loop", value: "3", icon: RotateCcwIcon, tone: "danger" },
  { label: "Offline หลังอัปเดต", value: "5", icon: WifiOffIcon, tone: "danger" },
];

/* Config Editor (GET /config) + Approval Center (GET /config?status=testing)
   ต่อ API จริงแล้ว — DEMO_CONFIGS / DEMO_PENDING_APPROVALS ถูกลบออก · ดู
   web/src/hooks/use-configs.ts + use-pending-approvals.ts */

/* ---------------------------------------------------------------- */
/*  Task Management — GET /tasks (โมดูล task = ฝั่ง B)               */
/* ---------------------------------------------------------------- */

export interface DemoTask {
  id: string;
  title: string;
  assignee: string;
  device: string;
  status: keyof typeof TASK_STATUS_TONE;
  due: string;
}

export const DEMO_TASKS: DemoTask[] = [
  {
    id: "tsk-208",
    title: "ติดตั้งกล่อง GPS รถบรรทุก 70-1234",
    assignee: "st.test",
    device: "DEV-0117",
    status: "in_progress",
    due: "วันนี้ 17:00",
  },
  {
    id: "tsk-205",
    title: "ตรวจเช็คสัญญาณรถโดยสารสาย 8",
    assignee: "ot.test",
    device: "DEV-0092",
    status: "pending",
    due: "พรุ่งนี้",
  },
  {
    id: "tsk-201",
    title: "เปลี่ยนซิมการ์ดอุปกรณ์ DEV-0043",
    assignee: "st.test",
    device: "DEV-0043",
    status: "completed",
    due: "เมื่อวาน",
  },
  {
    id: "tsk-198",
    title: "ย้ายกล่องจากรถเก่าไปรถใหม่",
    assignee: "ot.test",
    device: "DEV-0031",
    status: "cancelled",
    due: "3 วันก่อน",
  },
];

/* ---------------------------------------------------------------- */
/*  Firmware Repository — GET /firmware                             */
/* ---------------------------------------------------------------- */

export const DEMO_FIRMWARE = [
  {
    version: "GT06N-v2.4.1",
    models: "GT06N",
    uploadedAt: "1 สัปดาห์ก่อน",
    status: "stored",
  },
  {
    version: "GT06N-v2.4.0",
    models: "GT06N",
    uploadedAt: "1 เดือนก่อน",
    status: "stored",
  },
  {
    version: "GT06L-v1.8.3",
    models: "GT06L",
    uploadedAt: "2 สัปดาห์ก่อน",
    status: "stored",
  },
];

/* Device Search / Device Detail — ต่อ `GET /devices` จริงแล้ว (Sprint 2 #11)
 * ดู web/src/app/(app)/devices/ · DEMO_DEVICES / DEMO_DEVICE_DETAIL ถูกลบออก */

/* ---------------------------------------------------------------- */
/*  Campaign — ต่อ API จริงแล้ว (GET/POST /campaigns, Sprint 3 #21) —  */
/*  ดู campaigns/page.tsx + campaigns/campaign-wizard.tsx              */
/* ---------------------------------------------------------------- */

/* ---------------------------------------------------------------- */
/*  Incident & Rollback — ต่อ API จริงแล้ว (GET /incidents) — ดู       */
/*  incidents/incidents-view.tsx · DEMO_INCIDENTS ถูกลบออก             */
/* ---------------------------------------------------------------- */

/* User / Role Management — ต่อ API จริงแล้ว (GET /users/managed, POST/PATCH
   /users, แก้ครั้งที่ 38) DEMO_USERS ถูกลบออก — ดู
   web/src/app/(app)/users/user-management-view.tsx */
