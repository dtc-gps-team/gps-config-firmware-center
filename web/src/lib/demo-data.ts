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
  type PillTone,
  CONFIG_STATUS_TONE,
  TASK_STATUS_TONE,
} from "@/lib/status-pill";

export {
  pillClass,
  CONFIG_STATUS_TONE,
  TASK_STATUS_TONE,
  DEVICE_STATUS_TONE,
} from "@/lib/status-pill";

export const CAMPAIGN_STATUS_TONE: Record<string, PillTone> = {
  ร่าง: "neutral",
  กำลังทำงาน: "progress",
  เสร็จสิ้น: "success",
  หยุดชั่วคราว: "danger",
};

/* ---------------------------------------------------------------- */
/*  Dashboard — การ์ด "อุปกรณ์ทั้งหมด" + "Config รออนุมัติ" ต่อ API จริงแล้ว  */
/*  (GET /devices, GET /config) ที่ dashboard-summary.tsx · เหลือ 2 ใบนี้    */
/*  รอ endpoint campaign / incident (Sprint ถัดไป) · activity feed ยังเป็น    */
/*  ตัวอย่าง — รอ GET /audit-logs                                            */
/* ---------------------------------------------------------------- */

export const DEMO_DASHBOARD_SUMMARY = [
  { label: "Campaign กำลังทำงาน", value: "2" },
  { label: "Incident ที่ยังไม่ปิด", value: "1" },
];

export const DEMO_DASHBOARD_ACTIVITY = [
  { time: "09:24", text: "operation.test อนุมัติ Config GT06N/TCP (v3)" },
  { time: "08:51", text: "sw.test รัน simulation Config GT06L/TCP · ผ่าน" },
  {
    time: "08:10",
    text: "ระบบสร้าง Incident: อุปกรณ์ DEV-0042 sync ไม่สำเร็จ",
  },
  { time: "เมื่อวาน", text: "sw.test สร้าง Config ใหม่ GT06N/TCP" },
  { time: "เมื่อวาน", text: "operation.test เริ่ม Campaign 'นำร่องภาคเหนือ'" },
];

/* ---------------------------------------------------------------- */
/*  Config Editor — GET /config                                     */
/* ---------------------------------------------------------------- */

export interface DemoConfig {
  id: string;
  name: string;
  deviceModel: string;
  protocol: string;
  status: keyof typeof CONFIG_STATUS_TONE;
  updatedAt: string;
  createdBy: string;
  simulation: "ผ่าน" | "ไม่ผ่าน" | "-";
}

export const DEMO_CONFIGS: DemoConfig[] = [
  {
    id: "cfg-1041",
    name: "GT06N · ตั้งค่ามาตรฐานภาคกลาง",
    deviceModel: "GT06N",
    protocol: "TCP",
    status: "approved",
    updatedAt: "2 ชม.ก่อน",
    createdBy: "sw.test",
    simulation: "ผ่าน",
  },
  {
    id: "cfg-1040",
    name: "GT06N · รอบรายงานถี่ (ทดสอบ)",
    deviceModel: "GT06N",
    protocol: "TCP",
    status: "testing",
    updatedAt: "5 ชม.ก่อน",
    createdBy: "sw.test",
    simulation: "ผ่าน",
  },
  {
    id: "cfg-1039",
    name: "GT06L · ชุดร่างสำหรับลูกค้าใหม่",
    deviceModel: "GT06L",
    protocol: "TCP",
    status: "draft",
    updatedAt: "1 วันก่อน",
    createdBy: "sw.test",
    simulation: "-",
  },
  {
    id: "cfg-1037",
    name: "GT06N · ตั้งค่าที่ใช้งานจริง (sync แล้ว)",
    deviceModel: "GT06N",
    protocol: "TCP",
    status: "synced",
    updatedAt: "2 วันก่อน",
    createdBy: "sw.test",
    simulation: "ผ่าน",
  },
  {
    id: "cfg-1035",
    name: "GT06L · รอบรายงานถี่เกินไป (ถูกปฏิเสธ)",
    deviceModel: "GT06L",
    protocol: "TCP",
    status: "rejected",
    updatedAt: "3 วันก่อน",
    createdBy: "sw.test",
    simulation: "ไม่ผ่าน",
  },
];

/* ---------------------------------------------------------------- */
/*  Approval Center — GET /config?status=testing                    */
/* ---------------------------------------------------------------- */

export const DEMO_PENDING_APPROVALS = DEMO_CONFIGS.filter(
  (c) => c.status === "testing",
).concat([
  {
    id: "cfg-1038",
    name: "GT06N · ปรับ APN ผู้ให้บริการรายใหม่",
    deviceModel: "GT06N",
    protocol: "TCP",
    status: "testing",
    updatedAt: "1 วันก่อน",
    createdBy: "sw.test",
    simulation: "ผ่าน",
  },
  {
    id: "cfg-1036",
    name: "GT06L · เปิดอ่านค่า CAN bus",
    deviceModel: "GT06L",
    protocol: "TCP",
    status: "testing",
    updatedAt: "1 วันก่อน",
    createdBy: "sw.test",
    simulation: "ผ่าน",
  },
]);

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
/*  Campaign — โมดูล campaign (ยังไม่มี endpoint ในสเปค)             */
/* ---------------------------------------------------------------- */

export const DEMO_CAMPAIGNS = [
  {
    name: "นำร่องภาคเหนือ · GT06N v2.4.1",
    target: "Firmware GT06N-v2.4.1",
    failureRate: "0%",
    status: "กำลังทำงาน" as const,
  },
  {
    name: "อัปเดตรอบรายงาน Q3 · ภาคกลาง",
    target: "Config cfg-1037",
    failureRate: "1.2%",
    status: "กำลังทำงาน" as const,
  },
  {
    name: "ทดสอบ CAN bus · 20 คันแรก",
    target: "Config cfg-1036",
    failureRate: "0%",
    status: "เสร็จสิ้น" as const,
  },
  {
    name: "แก้ APN ผู้ให้บริการเก่า",
    target: "Config cfg-1010",
    failureRate: "4.8%",
    status: "หยุดชั่วคราว" as const,
  },
];

/* ---------------------------------------------------------------- */
/*  Incident & Rollback — โมดูล incident (ยังไม่มี endpoint ในสเปค)  */
/* ---------------------------------------------------------------- */

export const DEMO_INCIDENTS = [
  {
    device: "DEV-0042",
    detail: "sync Config เข้าระบบเดิมไม่สำเร็จ (timeout) 3 ครั้งติด",
    occurredAt: "08:10 วันนี้",
  },
  {
    device: "DEV-0188",
    detail: "อุปกรณ์รายงานเวอร์ชัน firmware ไม่ตรงกับที่ปล่อย",
    occurredAt: "เมื่อวาน",
  },
];

/* ---------------------------------------------------------------- */
/*  User / Role Management — โมดูล users (ยังไม่มี endpoint ในสเปค)  */
/*  ตรงกับ testUsers ใน backend/prisma/seed.ts                      */
/* ---------------------------------------------------------------- */

export const DEMO_USERS = [
  { username: "sw.test", fullName: "SW Tester", role: "SW" },
  {
    username: "operation.test",
    fullName: "Operation Tester",
    role: "Operation",
  },
  { username: "st.test", fullName: "ST Tester", role: "ST" },
  { username: "ot.test", fullName: "OT Tester", role: "OT" },
  { username: "auditor.test", fullName: "Auditor Tester", role: "Auditor" },
  { username: "admin.test", fullName: "Admin Tester", role: "Admin" },
  {
    username: "superadmin.test",
    fullName: "SuperAdmin Tester",
    role: "SuperAdmin",
  },
];
