/**
 * DEMO DATA — ข้อมูลตัวอย่างสำหรับ demo (ยังไม่ต่อ API จริง)
 * ============================================================
 * ทุกหน้าใน (app) ตอนนี้เป็น scaffold ที่ตั้งใจยังไม่ต่อ backend (Sprint 1
 * นับหน้าเว็บเป็นแค่โครง — ดู 02_GPS_Development_Plan.md) ไฟล์นี้ให้ข้อมูล
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
/*  status pill — className ตาม Tailwind default palette (แยกจาก theme   */
/*  token ใน globals.css โดยตั้งใจ: signal color ของ status ไม่ควรผูกกับ  */
/*  --primary/--accent) ใช้ร่วมกันทุกหน้า                                */
/* ---------------------------------------------------------------- */

type PillTone = "neutral" | "info" | "progress" | "success" | "danger";

const PILL_TONE: Record<PillTone, string> = {
  neutral: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  info: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  progress: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  success:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  danger: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
};

export function pillClass(tone: PillTone): string {
  return `inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${PILL_TONE[tone]}`;
}

/** Config lifecycle: draft → testing → approved → synced (rejected = ย้อน draft) */
export const CONFIG_STATUS_TONE: Record<string, PillTone> = {
  draft: "neutral",
  testing: "progress",
  approved: "success",
  synced: "info",
  rejected: "danger",
};

export const TASK_STATUS_TONE: Record<string, PillTone> = {
  pending: "neutral",
  in_progress: "progress",
  completed: "success",
  cancelled: "danger",
};

export const DEVICE_STATUS_TONE: Record<string, PillTone> = {
  registered: "neutral",
  installed: "success",
  decommissioned: "danger",
};

export const CAMPAIGN_STATUS_TONE: Record<string, PillTone> = {
  ร่าง: "neutral",
  กำลังทำงาน: "progress",
  เสร็จสิ้น: "success",
  หยุดชั่วคราว: "danger",
};

/* ---------------------------------------------------------------- */
/*  Dashboard — GET /config?status=testing / campaigns / incidents  */
/* ---------------------------------------------------------------- */

export const DEMO_DASHBOARD_SUMMARY = [
  { label: "อุปกรณ์ทั้งหมด", value: "1,284" },
  { label: "Config รออนุมัติ", value: "3" },
  { label: "Campaign กำลังทำงาน", value: "2" },
  { label: "Incident ที่ยังไม่ปิด", value: "1" },
];

export const DEMO_DASHBOARD_ACTIVITY = [
  { time: "09:24", text: "operation.test อนุมัติ Config GT06N/TCP (v3)" },
  { time: "08:51", text: "sw.test รัน simulation Config GT06L/TCP — ผ่าน" },
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
    name: "GT06N — ตั้งค่ามาตรฐานภาคกลาง",
    deviceModel: "GT06N",
    protocol: "TCP",
    status: "approved",
    updatedAt: "2 ชม.ก่อน",
    createdBy: "sw.test",
    simulation: "ผ่าน",
  },
  {
    id: "cfg-1040",
    name: "GT06N — รอบรายงานถี่ (ทดสอบ)",
    deviceModel: "GT06N",
    protocol: "TCP",
    status: "testing",
    updatedAt: "5 ชม.ก่อน",
    createdBy: "sw.test",
    simulation: "ผ่าน",
  },
  {
    id: "cfg-1039",
    name: "GT06L — ชุดร่างสำหรับลูกค้าใหม่",
    deviceModel: "GT06L",
    protocol: "TCP",
    status: "draft",
    updatedAt: "1 วันก่อน",
    createdBy: "sw.test",
    simulation: "-",
  },
  {
    id: "cfg-1037",
    name: "GT06N — ตั้งค่าที่ใช้งานจริง (sync แล้ว)",
    deviceModel: "GT06N",
    protocol: "TCP",
    status: "synced",
    updatedAt: "2 วันก่อน",
    createdBy: "sw.test",
    simulation: "ผ่าน",
  },
  {
    id: "cfg-1035",
    name: "GT06L — รอบรายงานถี่เกินไป (ถูกปฏิเสธ)",
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
    name: "GT06N — ปรับ APN ผู้ให้บริการรายใหม่",
    deviceModel: "GT06N",
    protocol: "TCP",
    status: "testing",
    updatedAt: "1 วันก่อน",
    createdBy: "sw.test",
    simulation: "ผ่าน",
  },
  {
    id: "cfg-1036",
    name: "GT06L — เปิดอ่านค่า CAN bus",
    deviceModel: "GT06L",
    protocol: "TCP",
    status: "testing",
    updatedAt: "1 วันก่อน",
    createdBy: "sw.test",
    simulation: "ผ่าน",
  },
]);

/* ---------------------------------------------------------------- */
/*  คลัง Parameter — GET /config-definitions                        */
/*  (ชุดย่อยของ 31 field ที่ seed จริงใน backend/prisma/seed.ts #74)  */
/* ---------------------------------------------------------------- */

export interface DemoParameter {
  fieldName: string;
  dataType: string;
  required: boolean;
  models: string;
}

export const DEMO_PARAMETERS: DemoParameter[] = [
  { fieldName: "APN", dataType: "string", required: true, models: "GT06N/TCP" },
  {
    fieldName: "APN_USER",
    dataType: "string",
    required: false,
    models: "GT06N/TCP",
  },
  {
    fieldName: "SERVER_HOST",
    dataType: "string",
    required: false,
    models: "GT06N/TCP, GT06L/TCP",
  },
  {
    fieldName: "SERVER_PORT",
    dataType: "number",
    required: false,
    models: "GT06N/TCP, GT06L/TCP",
  },
  {
    fieldName: "TRANSPORT_PROTOCOL",
    dataType: "string",
    required: false,
    models: "GT06N/TCP",
  },
  {
    fieldName: "REPORT_INTERVAL_MOVING",
    dataType: "number",
    required: false,
    models: "GT06N/TCP",
  },
  {
    fieldName: "GNSS_MODE",
    dataType: "string",
    required: false,
    models: "GT06N/TCP, GT06L/TCP",
  },
  {
    fieldName: "DIGITAL_INPUT_1",
    dataType: "string",
    required: false,
    models: "GT06N/TCP",
  },
  {
    fieldName: "SLEEP_MODE",
    dataType: "string",
    required: false,
    models: "GT06N/TCP",
  },
  {
    fieldName: "CAN_BUS_ENABLED",
    dataType: "boolean",
    required: false,
    models: "GT06N/TCP, GT06L/TCP",
  },
  {
    fieldName: "OBD_PROTOCOL",
    dataType: "string",
    required: false,
    models: "GT06N/TCP, GT06L/TCP",
  },
  {
    fieldName: "MTYP",
    dataType: "string",
    required: false,
    models: "GT06N/TCP",
  },
];

export const DEMO_PARAMETERS_TOTAL = 31;

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

/* ---------------------------------------------------------------- */
/*  Device Search — GET /devices (ยังไม่มี list endpoint ในสเปค)     */
/* ---------------------------------------------------------------- */

export interface DemoDevice {
  deviceId: string;
  sim: string;
  model: string;
  status: keyof typeof DEVICE_STATUS_TONE;
}

export const DEMO_DEVICES: DemoDevice[] = [
  {
    deviceId: "DEV-0117",
    sim: "0812345678",
    model: "GT06N",
    status: "installed",
  },
  {
    deviceId: "DEV-0092",
    sim: "0898765432",
    model: "GT06N",
    status: "installed",
  },
  {
    deviceId: "DEV-0043",
    sim: "0865551212",
    model: "GT06L",
    status: "installed",
  },
  {
    deviceId: "DEV-0201",
    sim: "0801119999",
    model: "GT06N",
    status: "registered",
  },
  {
    deviceId: "DEV-0007",
    sim: "0877773333",
    model: "GT06L",
    status: "decommissioned",
  },
];

export const DEMO_DEVICE_DETAIL = {
  deviceId: "DEV-0117",
  sim: "0812345678",
  model: "GT06N",
  protocol: "TCP",
  status: "installed" as const,
  configStatus: "synced",
  firmwareVersion: "GT06N-v2.4.1",
  lastCheckIn: "12 นาทีก่อน",
};

/* ---------------------------------------------------------------- */
/*  Campaign — โมดูล campaign (ยังไม่มี endpoint ในสเปค)             */
/* ---------------------------------------------------------------- */

export const DEMO_CAMPAIGNS = [
  {
    name: "นำร่องภาคเหนือ — GT06N v2.4.1",
    target: "Firmware GT06N-v2.4.1",
    failureRate: "0%",
    status: "กำลังทำงาน" as const,
  },
  {
    name: "อัปเดตรอบรายงาน Q3 — ภาคกลาง",
    target: "Config cfg-1037",
    failureRate: "1.2%",
    status: "กำลังทำงาน" as const,
  },
  {
    name: "ทดสอบ CAN bus — 20 คันแรก",
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
/*  Audit Log — โมดูล audit (ยังไม่มี endpoint ในสเปค)              */
/* ---------------------------------------------------------------- */

export const DEMO_AUDIT = [
  {
    time: "2026-09-04 09:24",
    actor: "operation.test",
    action: "config.approve",
    detail: "อนุมัติ Config cfg-1041 (GT06N/TCP)",
  },
  {
    time: "2026-09-04 08:51",
    actor: "sw.test",
    action: "config.simulate",
    detail: "รัน simulation cfg-1040 — ผ่าน",
  },
  {
    time: "2026-09-04 08:05",
    actor: "sw.test",
    action: "config.create",
    detail: "สร้าง Config cfg-1041",
  },
  {
    time: "2026-09-03 16:40",
    actor: "operation.test",
    action: "campaign.start",
    detail: "เริ่ม Campaign 'นำร่องภาคเหนือ'",
  },
  {
    time: "2026-09-03 14:12",
    actor: "admin.test",
    action: "user.create",
    detail: "เพิ่มผู้ใช้ ot.test (Role OT)",
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
];
