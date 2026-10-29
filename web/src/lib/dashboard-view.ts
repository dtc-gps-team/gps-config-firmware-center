/**
 * มุมมอง Dashboard ต่อ Role — ออกแบบจากงานของแต่ละ Role ไม่ใช่การกรองการ์ด
 *
 * ทุก Role ใช้โครงเดียวกัน (เรียนรู้ครั้งเดียว):
 *   แถวบน   [ ต้องทำตอนนี้ (คิวงานเรียงตามความเร่งด่วน) | สถานะระบบ (สรุปสั้น) ]
 *   แถวถัดไป แผงรายละเอียดตามที่ Role นั้นใช้
 * ต่างกันที่เนื้อหา: Operation ได้คิวอนุมัติ/ปล่อย Rollout, ConfigEngineer ได้
 * Config ของตัวเองที่ต้องแก้/ส่ง, QAEngineer ได้ Firmware รอตรวจ ฯลฯ · Role ที่ไม่มี
 * งานในคิว (Auditor/Admin) ใช้กิจกรรมล่าสุดเป็นแผงนำแทน
 *
 * ข้อจำกัดที่ derive จากสิทธิ์จริง: FirmwareEngineer/QAEngineer ไม่มี `campaign:Read`
 * (ไม่มีแผง Campaign) และ ConfigEngineer/FirmwareEngineer/QAEngineer เข้า Audit Log
 * ไม่ได้ (ไม่มีแผงกิจกรรม) · UX-level เหมือน `permissions.ts` — backend บังคับสิทธิ์จริง
 */

/** ชนิดของคิว "ต้องทำตอนนี้" · null = Role นี้ไม่มีคิวงาน (ใช้กิจกรรมล่าสุดนำแทน) */
export type QueueKind =
  | "operation"
  | "field"
  | "configEngineer"
  | "firmwareEngineer"
  | "qa"
  | null;

/** แถวในการ์ด "สถานะระบบ" */
export type HealthId =
  | "connection"
  | "offline"
  | "drift"
  | "devices"
  | "incident"
  | "deploy";

export type PanelId =
  | "rollouts"
  | "silent"
  | "configStatus"
  | "activity"
  | "firmwareStatus";

export type PanelSpan = 5 | 7 | 12;

export type DashboardView = {
  queue: QueueKind;
  health: HealthId[];
  /** แถวใต้แถวบน แต่ละแถวผลรวม span = 12 */
  rows: { id: PanelId; span: PanelSpan }[][];
};

const FIELD_HEALTH: HealthId[] = ["connection", "offline", "drift", "incident", "deploy"];

const VIEWS: Record<string, DashboardView> = {
  Operation: {
    queue: "operation",
    health: FIELD_HEALTH,
    rows: [
      [
        { id: "rollouts", span: 7 },
        { id: "silent", span: 5 },
      ],
      [
        { id: "configStatus", span: 5 },
        { id: "activity", span: 7 },
      ],
    ],
  },
  ST: {
    queue: "field",
    health: FIELD_HEALTH,
    rows: [
      [
        { id: "silent", span: 5 },
        { id: "rollouts", span: 7 },
      ],
      [{ id: "activity", span: 12 }],
    ],
  },
  OT: {
    queue: "field",
    health: FIELD_HEALTH,
    rows: [
      [
        { id: "silent", span: 5 },
        { id: "rollouts", span: 7 },
      ],
      [{ id: "activity", span: 12 }],
    ],
  },
  ConfigEngineer: {
    queue: "configEngineer",
    health: ["incident", "deploy"],
    rows: [
      [
        { id: "configStatus", span: 5 },
        { id: "rollouts", span: 7 },
      ],
    ],
  },
  FirmwareEngineer: {
    queue: "firmwareEngineer",
    health: ["devices", "incident"],
    rows: [[{ id: "firmwareStatus", span: 12 }]],
  },
  QAEngineer: {
    queue: "qa",
    health: ["devices", "incident"],
    rows: [[{ id: "firmwareStatus", span: 12 }]],
  },
  Auditor: {
    queue: null,
    health: FIELD_HEALTH,
    rows: [
      [
        { id: "rollouts", span: 7 },
        { id: "silent", span: 5 },
      ],
      [{ id: "configStatus", span: 12 }],
    ],
  },
  Admin: {
    queue: null,
    health: FIELD_HEALTH,
    rows: [
      [
        { id: "rollouts", span: 7 },
        { id: "silent", span: 5 },
      ],
      [{ id: "configStatus", span: 12 }],
    ],
  },
};
VIEWS.SuperAdmin = VIEWS.Admin;

/** Role ที่ไม่รู้จัก (หรือยังไม่มี session) ได้มุมมองอ่านอย่างเดียวแบบ Auditor */
export function dashboardView(role: string | null | undefined): DashboardView {
  return (role && VIEWS[role]) || VIEWS.Auditor;
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
