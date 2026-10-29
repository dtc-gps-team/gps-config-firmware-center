/**
 * มุมมอง Dashboard ต่อ Role — ตัดสินว่า Role ไหนเห็นการ์ด/แผงอะไรบ้าง และเรียง
 * อย่างไร เพื่อให้หน้าแรกตอบ "ตอนนี้มีอะไรต้องให้ฉันทำ" ของ Role นั้นจริงๆ
 * (ConfigEngineer ดู Config ของตัวเอง, QAEngineer ดูคิว Firmware รอตรวจ,
 * Operation ดู Rollout ที่รอปล่อย ฯลฯ) แทนที่ทุก Role เห็นหน้าเดียวกัน
 *
 * นี่เป็น UX-level เหมือน `permissions.ts` — การบังคับสิทธิ์จริงอยู่ที่ backend
 * ข้อจำกัดที่ derive จากสิทธิ์จริงอยู่แล้ว: FirmwareEngineer/QAEngineer ไม่มี
 * `campaign:Read` (ไม่มีแผง Campaign) และ ConfigEngineer/FirmwareEngineer/
 * QAEngineer เข้า Audit Log ไม่ได้ (ไม่มีแผงกิจกรรมล่าสุด)
 */

/** การ์ดในแถบ "ต้องลงมือทำ" */
export type RiskId = "paused" | "incident" | "offline" | "drift";

/** ตัวเลขนิ่งท้ายแถบ */
export type StatId = "devices" | "models" | "configsPending" | "campaigns";

/** แผงกลุ่มกลางหน้า (hook-driven ใน DashboardSummary) */
export type SummaryPanelId = "rollouts" | "silent" | "deploy" | "connection";

/** แผงที่เป็นของ Role นั้นโดยเฉพาะ / แผงรวมท้ายหน้า */
export type FocusPanelId =
  | "myConfigs"
  | "firmwareQueue"
  | "configStatus"
  | "activity";

export type PanelSpan = 5 | 7 | 12;

export type DashboardView = {
  /** แถวบนสุดใต้แถบรออนุมัติ: แผงเฉพาะ Role */
  focus: { id: FocusPanelId; span: PanelSpan }[];
  risk: RiskId[];
  summary: { id: SummaryPanelId; span: PanelSpan }[];
  stats: StatId[];
  /** แผงท้ายหน้า */
  lower: { id: FocusPanelId; span: PanelSpan }[];
};

const ALL_RISK: RiskId[] = ["paused", "incident", "offline", "drift"];
const ALL_STATS: StatId[] = ["devices", "models", "configsPending", "campaigns"];

const OPERATION: DashboardView = {
  focus: [],
  risk: ALL_RISK,
  summary: [
    { id: "rollouts", span: 7 },
    { id: "silent", span: 5 },
    { id: "deploy", span: 7 },
    { id: "connection", span: 5 },
  ],
  stats: ALL_STATS,
  lower: [
    { id: "configStatus", span: 5 },
    { id: "activity", span: 7 },
  ],
};

const FIELD: DashboardView = {
  focus: [],
  risk: ALL_RISK,
  summary: [
    { id: "silent", span: 5 },
    { id: "connection", span: 7 },
    { id: "rollouts", span: 7 },
    { id: "deploy", span: 5 },
  ],
  stats: ["devices", "models", "campaigns"],
  lower: [{ id: "activity", span: 12 }],
};

const READ_ONLY: DashboardView = {
  focus: [],
  risk: ALL_RISK,
  summary: [
    { id: "deploy", span: 7 },
    { id: "connection", span: 5 },
    { id: "rollouts", span: 7 },
    { id: "silent", span: 5 },
  ],
  stats: ALL_STATS,
  lower: [
    { id: "configStatus", span: 5 },
    { id: "activity", span: 7 },
  ],
};

const VIEWS: Record<string, DashboardView> = {
  Operation: OPERATION,
  ST: FIELD,
  OT: FIELD,
  Auditor: READ_ONLY,
  Admin: READ_ONLY,
  SuperAdmin: READ_ONLY,
  ConfigEngineer: {
    focus: [
      { id: "myConfigs", span: 7 },
      { id: "configStatus", span: 5 },
    ],
    risk: ["incident", "paused"],
    summary: [
      { id: "rollouts", span: 7 },
      { id: "deploy", span: 5 },
    ],
    stats: ["devices", "models", "configsPending", "campaigns"],
    lower: [],
  },
  FirmwareEngineer: {
    focus: [{ id: "firmwareQueue", span: 12 }],
    risk: ["incident"],
    summary: [],
    stats: ["devices", "models"],
    lower: [],
  },
  QAEngineer: {
    focus: [{ id: "firmwareQueue", span: 12 }],
    risk: ["incident"],
    summary: [],
    stats: ["devices", "models"],
    lower: [],
  },
};

/** Role ที่ไม่รู้จัก (หรือยังไม่มี session) ได้มุมมองอ่านอย่างเดียวที่
 *  ไม่มีแผงเฉพาะ Role ซึ่งเป็นชุดที่ปลอดภัยที่สุด */
export function dashboardView(role: string | null | undefined): DashboardView {
  return (role && VIEWS[role]) || READ_ONLY;
}

const SPAN_CLASS: Record<PanelSpan, string> = {
  5: "lg:col-span-5",
  7: "lg:col-span-7",
  12: "lg:col-span-12",
};

/** class ของ grid cell (ต้องเป็นสตริงเต็มให้ Tailwind เห็น) */
export function spanClass(span: PanelSpan): string {
  return SPAN_CLASS[span];
}
